import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessUserRole,
  OwnershipTransferStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateBusinessUserDto } from './dto/update-business-user.dto';
import { QueryBusinessUserDto } from './dto/query-business-user.dto';
import { BusinessUserResponse } from './interfaces/business-user.interface';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { canManageRole } from './team-rules';

const memberUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} satisfies Prisma.UserSelect;

/**
 * El equipo de un negocio: listar, cambiar el rol, sacar a alguien y salirse.
 *
 * Nadie entra por aquí: se entra aceptando una invitación (`invitations`).
 * Quién maneja a quién está en `team-rules.ts`.
 */
@Injectable()
export class BusinessUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getUsersByBusiness(businessId: string, query: QueryBusinessUserDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const term = search?.trim();
    const where: Prisma.BusinessUserWhereInput = {
      businessId,
      ...(term
        ? {
            user: {
              OR: (['firstName', 'lastName', 'email'] as const).map(
                (field) => ({
                  [field]: { contains: term, mode: 'insensitive' as const },
                }),
              ),
            },
          }
        : {}),
    };

    return paginate(
      this.prisma.businessUser,
      {
        where,
        include: { user: { select: memberUserSelect } },
        orderBy: [{ [sortBy]: order }, { id: 'asc' }],
      },
      { page, limit },
    );
  }

  async updateUserRole(
    businessId: string,
    businessUserId: string,
    dto: UpdateBusinessUserDto,
    currentUserId: string,
  ): Promise<BusinessUserResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { membership, actorRole } = await this.lockTarget(
        tx,
        businessId,
        businessUserId,
        currentUserId,
        'role',
      );

      if (!canManageRole(actorRole, dto.role)) {
        throw new ForbiddenException(
          dto.role === BusinessUserRole.ADMIN
            ? 'Solo el dueño puede nombrar administradores'
            : 'No puedes asignar ese rol',
        );
      }

      if (membership.role === dto.role) {
        return tx.businessUser.findUniqueOrThrow({
          where: { id: membership.id },
          include: { user: { select: memberUserSelect } },
        });
      }

      const updated = await tx.businessUser.update({
        where: { id: membership.id },
        data: { role: dto.role },
        include: { user: { select: memberUserSelect } },
      });

      await this.auditService.log(
        {
          userId: currentUserId,
          action: AuditAction.BUSINESS_USER_ROLE_UPDATED,
          entity: 'BusinessUser',
          entityId: membership.id,
          meta: {
            userId: membership.userId,
            businessId,
            previousRole: membership.role,
            newRole: dto.role,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async removeUserFromBusiness(
    businessId: string,
    businessUserId: string,
    currentUserId: string,
  ): Promise<{ message: string }> {
    await this.prisma.$transaction(async (tx) => {
      const { membership } = await this.lockTarget(
        tx,
        businessId,
        businessUserId,
        currentUserId,
        'remove',
      );

      await this.deleteMembership(tx, membership);

      await this.auditService.log(
        {
          userId: currentUserId,
          action: AuditAction.BUSINESS_USER_REMOVED,
          entity: 'BusinessUser',
          entityId: membership.id,
          meta: {
            userId: membership.userId,
            businessId,
            role: membership.role,
          },
        },
        tx,
      );
    });

    return { message: 'Usuario eliminado del negocio correctamente' };
  }

  /**
   * Salirse del negocio por cuenta propia. El dueño no puede: primero
   * transfiere el negocio, para que nunca quede sin dueño.
   */
  async leaveBusiness(
    businessId: string,
    currentUserId: string,
  ): Promise<{ message: string }> {
    await this.prisma.$transaction(async (tx) => {
      const business = await this.lockBusiness(tx, businessId);
      if (business.ownerId === currentUserId) {
        throw new BadRequestException(
          'Eres el dueño: transfiere el negocio antes de salirte',
        );
      }

      const membership = await tx.businessUser.findUnique({
        where: { businessId_userId: { businessId, userId: currentUserId } },
      });
      if (!membership) {
        throw new NotFoundException('No perteneces a este negocio');
      }

      await this.deleteMembership(tx, membership);

      await this.auditService.log(
        {
          userId: currentUserId,
          action: AuditAction.BUSINESS_USER_LEFT,
          entity: 'BusinessUser',
          entityId: membership.id,
          meta: { userId: currentUserId, businessId, role: membership.role },
        },
        tx,
      );
    });

    return { message: 'Saliste del negocio' };
  }

  // ---------------------------------------------------------- utilidades

  /**
   * Bloquea el negocio y valida que el miembro sea de ese negocio y que quien
   * actúa pueda manejarlo. El bloqueo hace que una transferencia de la
   * propiedad o un cambio de rol simultáneos se apliquen uno detrás del otro,
   * así que lo que se lee aquí (dueño y roles) no cambia hasta terminar.
   */
  private async lockTarget(
    tx: Prisma.TransactionClient,
    businessId: string,
    businessUserId: string,
    currentUserId: string,
    action: 'role' | 'remove',
  ) {
    const business = await this.lockBusiness(tx, businessId);

    // Por negocio: un id de otro negocio responde 404, como si no existiera.
    const membership = await tx.businessUser.findFirst({
      where: { id: businessUserId, businessId },
    });
    if (!membership) {
      throw new NotFoundException('Usuario no encontrado en el negocio');
    }

    if (
      membership.userId === business.ownerId ||
      membership.role === BusinessUserRole.OWNER
    ) {
      throw new ForbiddenException(
        action === 'remove'
          ? 'No puedes sacar al dueño del negocio'
          : 'No puedes cambiarle el rol al dueño del negocio',
      );
    }
    if (membership.userId === currentUserId) {
      throw new ForbiddenException(
        action === 'remove'
          ? 'Para salirte del negocio usa "Salir del negocio"'
          : 'No puedes modificar tu propio rol',
      );
    }

    const actor = await tx.businessUser.findUnique({
      where: { businessId_userId: { businessId, userId: currentUserId } },
      select: { role: true },
    });
    if (!canManageRole(actor?.role, membership.role)) {
      throw new ForbiddenException(
        membership.role === BusinessUserRole.ADMIN
          ? 'Solo el dueño puede manejar a los administradores'
          : 'No puedes manejar a este miembro',
      );
    }

    return { membership, actorRole: actor!.role };
  }

  private async lockBusiness(tx: Prisma.TransactionClient, businessId: string) {
    const [business] = await tx.$queryRaw<{ ownerId: string }[]>`
      SELECT "ownerId" FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
    if (!business) throw new NotFoundException('Negocio no encontrado');
    return business;
  }

  /**
   * Borra la membresía. Si tenía una transferencia del negocio por responder,
   * se cancela: ya no es miembro y no puede pasar a ser el dueño.
   */
  private async deleteMembership(
    tx: Prisma.TransactionClient,
    membership: { id: string; businessId: string; userId: string },
  ) {
    await tx.businessUser.delete({ where: { id: membership.id } });
    await tx.businessOwnershipTransfer.updateMany({
      where: {
        businessId: membership.businessId,
        toUserId: membership.userId,
        status: OwnershipTransferStatus.PENDING,
      },
      data: {
        status: OwnershipTransferStatus.CANCELLED,
        respondedAt: new Date(),
      },
    });
  }
}
