import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessOwnershipTransfer,
  BusinessUserRole,
  OwnershipTransferStatus,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { EmailProvider } from 'src/providers/email.provider';

/** Días que tiene el miembro para aceptar o rechazar la transferencia. */
const TRANSFER_EXPIRATION_DAYS = 7;

/**
 * Qué se le dice a quien intenta responder una propuesta que ya no está
 * pendiente. "Ya fue respondida" a secas confundía: la mayoría de las veces la
 * canceló el dueño o lo sacaron del equipo, no la respondió él.
 */
const RESOLVED_MESSAGE: Record<OwnershipTransferStatus, string> = {
  PENDING: 'La propuesta sigue pendiente',
  ACCEPTED: 'Ya aceptaste esta propuesta',
  REJECTED: 'Ya rechazaste esta propuesta',
  CANCELLED:
    'Esta propuesta ya no está vigente: el dueño la canceló o ya no eres parte del equipo',
  EXPIRED: 'Esta propuesta venció',
};

/** Cuántas propuestas ya respondidas devuelve el historial de un negocio. */
const HISTORY_LIMIT = 3;

const personSelect = { id: true, firstName: true, lastName: true } as const;

const transferInclude = {
  business: { select: { id: true, name: true } },
  fromUser: { select: personSelect },
  toUser: { select: personSelect },
} satisfies Prisma.BusinessOwnershipTransferInclude;

@Injectable()
export class BusinessOwnershipService {
  private readonly logger = new Logger(BusinessOwnershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailProvider: EmailProvider,
  ) {}

  /** El dueño propone pasarle el negocio a uno de sus miembros. */
  async requestTransfer(
    businessId: string,
    ownerId: string,
    toUserId: string,
    password: string,
  ) {
    const business = await this.requireOwnedActiveBusiness(businessId, ownerId);
    await this.assertPassword(ownerId, password);

    if (toUserId === ownerId) {
      throw new BadRequestException('Ya eres el dueño de este negocio');
    }

    const membership = await this.prisma.businessUser.findFirst({
      where: {
        businessId,
        userId: toUserId,
        user: { inactivatedAt: null, anonymizedAt: null },
      },
    });
    if (!membership) {
      throw new BadRequestException(
        'Solo puedes transferir el negocio a un miembro activo del negocio',
      );
    }

    if (await this.findPending(businessId)) {
      throw new ConflictException(
        'Ya hay una transferencia pendiente para este negocio. Cancélala antes de proponer otra.',
      );
    }

    const transfer = await this.prisma.businessOwnershipTransfer.create({
      data: {
        businessId,
        fromUserId: ownerId,
        toUserId,
        expiresAt: new Date(
          Date.now() + TRANSFER_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
      include: transferInclude,
    });

    await this.auditService.log({
      userId: ownerId,
      action: AuditAction.BUSINESS_OWNERSHIP_TRANSFER_REQUESTED,
      entity: 'Business',
      entityId: business.id,
      meta: { transferId: transfer.id, toUserId },
    });

    return transfer;
  }

  /** Transferencia pendiente de un negocio, visible para el dueño o el destinatario. */
  async getPendingForBusiness(businessId: string, userId: string) {
    const transfer = await this.findPending(businessId);
    if (
      !transfer ||
      (transfer.fromUserId !== userId && transfer.toUserId !== userId)
    ) {
      return null;
    }
    return transfer;
  }

  async cancelTransfer(businessId: string, ownerId: string) {
    await this.requireOwnedActiveBusiness(businessId, ownerId);

    const transfer = await this.findPending(businessId);
    if (!transfer) {
      throw new NotFoundException('No hay una transferencia pendiente');
    }

    await this.close(transfer, OwnershipTransferStatus.CANCELLED);
    await this.auditService.log({
      userId: ownerId,
      action: AuditAction.BUSINESS_OWNERSHIP_TRANSFER_CANCELLED,
      entity: 'Business',
      entityId: businessId,
      meta: { transferId: transfer.id },
    });

    return { message: 'Transferencia cancelada' };
  }

  /**
   * Las últimas propuestas ya resueltas del negocio (aceptadas, rechazadas,
   * vencidas o canceladas) en las que el usuario participó. Así el dueño ve
   * qué pasó con lo que propuso, también después de dejar de ser el dueño.
   *
   * Una pendiente cuyo plazo ya pasó se devuelve como `EXPIRED` aunque la
   * tarea diaria todavía no la haya marcado.
   */
  async listHistory(businessId: string, userId: string) {
    const now = new Date();
    const transfers = await this.prisma.businessOwnershipTransfer.findMany({
      where: {
        businessId,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
        NOT: {
          status: OwnershipTransferStatus.PENDING,
          expiresAt: { gt: now },
        },
      },
      include: transferInclude,
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });

    return transfers.map((transfer) =>
      transfer.status === OwnershipTransferStatus.PENDING
        ? {
            ...transfer,
            status: OwnershipTransferStatus.EXPIRED,
            respondedAt: transfer.expiresAt,
          }
        : transfer,
    );
  }

  /** Transferencias que el usuario tiene por responder. */
  listIncoming(userId: string) {
    return this.prisma.businessOwnershipTransfer.findMany({
      where: {
        toUserId: userId,
        status: OwnershipTransferStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: transferInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async rejectTransfer(transferId: string, userId: string) {
    const transfer = await this.requireIncomingPending(transferId, userId);

    await this.close(transfer, OwnershipTransferStatus.REJECTED);
    await this.auditService.log({
      userId,
      action: AuditAction.BUSINESS_OWNERSHIP_TRANSFER_REJECTED,
      entity: 'Business',
      entityId: transfer.businessId,
      meta: { transferId },
    });

    await this.notifyOwner(transfer, userId, false);

    return { message: 'Transferencia rechazada' };
  }

  /**
   * El miembro acepta y pasa a ser el dueño; el dueño anterior queda como
   * ADMIN. Se acepta aunque el dueño anterior haya desactivado su cuenta o
   * pedido eliminarla: es justo el caso en que transfiere antes de irse.
   */
  async acceptTransfer(transferId: string, userId: string) {
    const transfer = await this.requireIncomingPending(transferId, userId);

    const business = await this.prisma.business.findUnique({
      where: { id: transfer.businessId },
    });
    if (!business || business.inactivatedAt) {
      await this.close(transfer, OwnershipTransferStatus.CANCELLED);
      throw new BadRequestException('El negocio ya no está activo');
    }
    if (business.ownerId !== transfer.fromUserId) {
      await this.close(transfer, OwnershipTransferStatus.CANCELLED);
      throw new BadRequestException(
        'Quien te propuso la transferencia ya no es el dueño del negocio',
      );
    }
    const membership = await this.prisma.businessUser.findUnique({
      where: { businessId_userId: { businessId: business.id, userId } },
    });
    if (!membership) {
      await this.close(transfer, OwnershipTransferStatus.CANCELLED);
      throw new BadRequestException('Ya no eres miembro de este negocio');
    }

    await this.prisma.$transaction(async (tx) => {
      // La condición de estado impide aceptar dos veces la misma propuesta
      // si llegan dos peticiones a la vez.
      const { count } = await tx.businessOwnershipTransfer.updateMany({
        where: { id: transfer.id, status: OwnershipTransferStatus.PENDING },
        data: {
          status: OwnershipTransferStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException('La transferencia ya fue respondida');
      }

      await tx.business.update({
        where: { id: business.id },
        data: { ownerId: userId },
      });
      await tx.businessUser.update({
        where: {
          businessId_userId: { businessId: business.id, userId },
        },
        data: { role: BusinessUserRole.OWNER },
      });
      await tx.businessUser.updateMany({
        where: { businessId: business.id, userId: transfer.fromUserId },
        data: { role: BusinessUserRole.ADMIN },
      });
    });

    await this.auditService.log({
      userId,
      action: AuditAction.BUSINESS_OWNERSHIP_TRANSFERRED,
      entity: 'Business',
      entityId: business.id,
      meta: {
        transferId,
        previousOwnerId: transfer.fromUserId,
        newOwnerId: userId,
      },
    });

    await this.notifyOwner(transfer, userId, true);

    return { message: `Ahora eres el dueño de ${business.name}` };
  }

  // ---------------------------------------------------------- utilidades

  /**
   * Le avisa por correo a quien propuso la transferencia. Es un aviso: si el
   * correo falla (o el dueño no tiene correo), la respuesta ya quedó guardada
   * y no se revierte.
   */
  private async notifyOwner(
    transfer: BusinessOwnershipTransfer,
    responderId: string,
    accepted: boolean,
  ) {
    try {
      const [owner, responder, business] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: transfer.fromUserId },
          select: { email: true },
        }),
        this.prisma.user.findUnique({
          where: { id: responderId },
          select: { firstName: true, lastName: true },
        }),
        this.prisma.business.findUnique({
          where: { id: transfer.businessId },
          select: { name: true },
        }),
      ]);
      if (!owner?.email || !responder || !business) return;

      // Resend no lanza cuando el envío falla: devuelve `{ error }`.
      const result = await this.emailProvider.sendOwnershipTransferResponse(
        owner.email,
        {
          businessName: business.name,
          responderName: `${responder.firstName} ${responder.lastName}`.trim(),
          accepted,
        },
      );
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar la respuesta de la transferencia ${transfer.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private findPending(businessId: string) {
    return this.prisma.businessOwnershipTransfer.findFirst({
      where: {
        businessId,
        status: OwnershipTransferStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: transferInclude,
    });
  }

  private async close(
    transfer: BusinessOwnershipTransfer,
    status: OwnershipTransferStatus,
  ) {
    await this.prisma.businessOwnershipTransfer.updateMany({
      where: { id: transfer.id, status: OwnershipTransferStatus.PENDING },
      data: { status, respondedAt: new Date() },
    });
  }

  private async requireIncomingPending(transferId: string, userId: string) {
    const transfer = await this.prisma.businessOwnershipTransfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer || transfer.toUserId !== userId) {
      throw new NotFoundException('Transferencia no encontrada');
    }
    if (transfer.status !== OwnershipTransferStatus.PENDING) {
      throw new ConflictException(RESOLVED_MESSAGE[transfer.status]);
    }
    if (transfer.expiresAt <= new Date()) {
      await this.close(transfer, OwnershipTransferStatus.EXPIRED);
      throw new BadRequestException('La transferencia venció');
    }
    return transfer;
  }

  private async requireOwnedActiveBusiness(businessId: string, userId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Negocio no encontrado');
    if (business.ownerId !== userId) {
      throw new ForbiddenException('Solo el dueño puede transferir el negocio');
    }
    if (business.inactivatedAt) {
      throw new BadRequestException('El negocio está inactivo');
    }
    return business;
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      throw new BadRequestException('La contraseña no es correcta');
    }
  }
}
