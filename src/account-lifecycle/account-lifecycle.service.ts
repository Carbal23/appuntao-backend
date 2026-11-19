import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthLogEvent,
  DebtStatus,
  InactivationSource,
  OwnershipTransferStatus,
  User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditAction } from 'src/audit/audit.types';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import {
  AuthLogReason,
  type RequestContext,
} from 'src/auth-log/auth-log.types';
import {
  DeletionPreviewDto,
  OwnedBusinessSummaryDto,
  RequestAccountDeletionDto,
} from './dto/account-lifecycle.dto';

/** Estado de la cuenta al intentar iniciar sesión. */
export type LoginAccountState =
  | 'ACTIVE'
  | 'DEACTIVATED' // la desactivó el propio usuario: puede reactivarla
  | 'DELETION_PENDING' // pidió eliminarla y está dentro del plazo de gracia
  | 'DISABLED'; // la desactivó un administrador

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountLifecycleService {
  private readonly logger = new Logger(AccountLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authLog: AuthLogService,
  ) {}

  private get gracePeriodDays(): number {
    return this.config.getOrThrow<number>('account.deletionGraceDays');
  }

  private get inactiveRetentionMonths(): number {
    return this.config.getOrThrow<number>('account.inactiveRetentionMonths');
  }

  private get closedBusinessRetentionMonths(): number {
    return this.config.getOrThrow<number>(
      'account.closedBusinessRetentionMonths',
    );
  }

  // ------------------------------------------------------------- login

  loginState(user: User): LoginAccountState {
    if (!user.inactivatedAt) return 'ACTIVE';
    if (user.inactivatedBy !== InactivationSource.SELF) return 'DISABLED';
    return user.deletionScheduledAt ? 'DELETION_PENDING' : 'DEACTIVATED';
  }

  /**
   * Error que recibe el frontend cuando la cuenta no está activa. Solo se
   * lanza después de comprobar la contraseña, para no revelar el estado de
   * una cuenta a quien no es su dueño.
   */
  loginBlockedException(user: User, state: LoginAccountState) {
    if (state === 'DISABLED') {
      return new ForbiddenException({
        statusCode: 403,
        error: 'ACCOUNT_DISABLED',
        message: 'Tu cuenta fue desactivada. Comunícate con soporte.',
      });
    }
    if (state === 'DELETION_PENDING') {
      return new ForbiddenException({
        statusCode: 403,
        error: 'ACCOUNT_DELETION_PENDING',
        message: `Tu cuenta está programada para eliminarse el ${formatDate(user.deletionScheduledAt!)}. Si quieres conservarla, cancela la eliminación.`,
        deletionScheduledAt: user.deletionScheduledAt,
      });
    }
    return new ForbiddenException({
      statusCode: 403,
      error: 'ACCOUNT_DEACTIVATED',
      message: 'Tu cuenta está desactivada. ¿Quieres reactivarla?',
    });
  }

  /** Reactiva la cuenta desde el login: cancela también una eliminación pendiente. */
  async reactivate(user: User, context?: RequestContext): Promise<User> {
    const cancellingDeletion = !!user.deletionScheduledAt;

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        inactivatedAt: null,
        inactivatedBy: null,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      },
    });

    await this.authLog.record({
      event: cancellingDeletion
        ? AuthLogEvent.ACCOUNT_DELETION_CANCELLED
        : AuthLogEvent.ACCOUNT_REACTIVATED,
      userId: user.id,
      context,
    });

    return updated;
  }

  // ------------------------------------------------- acciones del usuario

  async deactivate(
    userId: string,
    password: string,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    await this.assertPassword(userId, password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          inactivatedAt: new Date(),
          inactivatedBy: InactivationSource.SELF,
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    await this.authLog.record({
      event: AuthLogEvent.ACCOUNT_DEACTIVATED,
      userId,
      context,
    });

    return {
      message:
        'Tu cuenta fue desactivada. Puedes reactivarla cuando quieras iniciando sesión.',
    };
  }

  async getDeletionPreview(userId: string): Promise<DeletionPreviewDto> {
    return {
      gracePeriodDays: this.gracePeriodDays,
      ownedBusinesses: await this.activeOwnedBusinesses(userId),
    };
  }

  async requestDeletion(
    userId: string,
    dto: RequestAccountDeletionDto,
    context?: RequestContext,
  ): Promise<{ message: string; deletionScheduledAt: Date }> {
    await this.assertPassword(userId, dto.password);

    // La eliminación nunca se bloquea por tener negocios, pero el dueño debe
    // confirmar que entiende que se cerrarán.
    const ownedBusinesses = await this.activeOwnedBusinesses(userId);
    if (ownedBusinesses.length && !dto.acknowledgeBusinessClosure) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'BUSINESS_CLOSURE_ACK_REQUIRED',
        message:
          'Eres dueño de negocios activos. Al eliminar tu cuenta se cerrarán y sus datos se eliminarán más adelante. Confirma que lo entiendes.',
        ownedBusinesses,
      });
    }

    const now = new Date();
    const deletionScheduledAt = new Date(
      now.getTime() + this.gracePeriodDays * DAY_MS,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          inactivatedAt: now,
          inactivatedBy: InactivationSource.SELF,
          deletionRequestedAt: now,
          deletionScheduledAt,
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    await this.authLog.record({
      event: AuthLogEvent.ACCOUNT_DELETION_REQUESTED,
      userId,
      reason: ownedBusinesses.length
        ? AuthLogReason.BUSINESS_CLOSURE_ACKNOWLEDGED
        : undefined,
      context,
    });

    return {
      message: `Tu cuenta se eliminará el ${formatDate(deletionScheduledAt)}. Hasta esa fecha puedes cancelarlo iniciando sesión.`,
      deletionScheduledAt,
    };
  }

  // -------------------------------------------- acciones de administrador

  async deactivateByAdmin(
    targetId: string,
    actorId: string,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    if (targetId === actorId) {
      throw new BadRequestException(
        'Para desactivar tu propia cuenta usa POST /users/me/deactivate',
      );
    }
    const user = await this.requireUser(targetId);
    if (user.anonymizedAt) {
      throw new BadRequestException('La cuenta fue eliminada');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: {
          inactivatedAt: user.inactivatedAt ?? new Date(),
          inactivatedBy: InactivationSource.ADMIN,
          // Un administrador que desactiva la cuenta también detiene una
          // eliminación pendiente: la cuenta queda bajo su control.
          deletionRequestedAt: null,
          deletionScheduledAt: null,
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: targetId } }),
    ]);

    await this.authLog.record({
      event: AuthLogEvent.ACCOUNT_DEACTIVATED,
      userId: targetId,
      reason: AuthLogReason.BY_ADMIN,
      context,
    });

    return { message: 'Usuario desactivado' };
  }

  async reactivateByAdmin(
    targetId: string,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    const user = await this.requireUser(targetId);
    if (user.anonymizedAt) {
      throw new BadRequestException(
        'La cuenta fue eliminada y no se puede recuperar',
      );
    }
    if (!user.inactivatedAt) {
      throw new BadRequestException('La cuenta ya está activa');
    }
    if (user.deletionScheduledAt) {
      throw new BadRequestException(
        'El usuario pidió eliminar su cuenta: solo él puede cancelarlo',
      );
    }

    await this.prisma.user.update({
      where: { id: targetId },
      data: { inactivatedAt: null, inactivatedBy: null },
    });

    await this.authLog.record({
      event: AuthLogEvent.ACCOUNT_REACTIVATED,
      userId: targetId,
      reason: AuthLogReason.BY_ADMIN,
      context,
    });

    return { message: 'Usuario reactivado' };
  }

  // ---------------------------------------------------- anonimización

  /**
   * Elimina los datos personales del usuario. Es definitivo.
   *
   * No borra datos de negocio: deudas, pagos y los registros de deudor que
   * crearon los negocios se conservan (son del negocio); solo se rompe el
   * vínculo con la cuenta. Los negocios de los que era dueño se cierran.
   * Sus aceptaciones legales se conservan, marcadas como revocadas.
   */
  async anonymize(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.anonymizedAt) return false;

    const now = new Date();
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, anonymizedAt: null },
        data: {
          firstName: 'Usuario',
          lastName: 'eliminado',
          email: null,
          phone: null,
          // documentNumber es obligatorio y único: un valor que no
          // corresponde a nadie libera el documento real para un registro
          // futuro.
          documentNumber: `deleted-${userId}`,
          password: null,
          inactivatedAt: user.inactivatedAt ?? now,
          deletionScheduledAt: null,
          anonymizedAt: now,
        },
      });
      if (count === 0) return false;

      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.debtor.updateMany({
        where: { userId },
        data: { userId: null },
      });
      await tx.userConsent.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Sale de los negocios donde era miembro; los suyos se cierran.
      await tx.businessUser.deleteMany({
        where: { userId, business: { ownerId: { not: userId } } },
      });
      // Si nadie aceptó la transferencia a tiempo, el negocio se cierra.
      await tx.businessOwnershipTransfer.updateMany({
        where: {
          status: OwnershipTransferStatus.PENDING,
          OR: [{ fromUserId: userId }, { toUserId: userId }],
        },
        data: { status: OwnershipTransferStatus.CANCELLED, respondedAt: now },
      });
      await tx.business.updateMany({
        where: { ownerId: userId, inactivatedAt: null },
        data: { inactivatedAt: now },
      });
      return true;
    });

    if (done) {
      await this.authLog.record({
        event: AuthLogEvent.ACCOUNT_ANONYMIZED,
        userId,
        reason: user.deletionScheduledAt
          ? AuthLogReason.DELETION_REQUESTED
          : AuthLogReason.INACTIVE_RETENTION_EXPIRED,
      });
    }
    return done;
  }

  /**
   * Tarea diaria: anonimiza las eliminaciones cuyo plazo de gracia venció y
   * las cuentas desactivadas por más tiempo que el plazo de retención.
   */
  async runMaintenance(now = new Date()) {
    const retentionLimit = new Date(now);
    retentionLimit.setUTCMonth(
      retentionLimit.getUTCMonth() - this.inactiveRetentionMonths,
    );

    const [dueDeletions, expiredInactive] = await Promise.all([
      this.prisma.user.findMany({
        where: { anonymizedAt: null, deletionScheduledAt: { lte: now } },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: {
          anonymizedAt: null,
          deletionScheduledAt: null,
          inactivatedAt: { lte: retentionLimit },
        },
        select: { id: true },
      }),
    ]);

    const { count: transfersExpired } =
      await this.prisma.businessOwnershipTransfer.updateMany({
        where: {
          status: OwnershipTransferStatus.PENDING,
          expiresAt: { lte: now },
        },
        data: { status: OwnershipTransferStatus.EXPIRED, respondedAt: now },
      });

    const businessRetentionLimit = new Date(now);
    businessRetentionLimit.setUTCMonth(
      businessRetentionLimit.getUTCMonth() - this.closedBusinessRetentionMonths,
    );

    let deletionsProcessed = 0;
    let inactiveAnonymized = 0;
    for (const { id } of dueDeletions) {
      if (await this.anonymize(id)) deletionsProcessed++;
    }
    for (const { id } of expiredInactive) {
      if (await this.anonymize(id)) inactiveAnonymized++;
    }

    const expiredBusinesses = await this.prisma.business.findMany({
      where: { inactivatedAt: { lte: businessRetentionLimit } },
      select: { id: true },
    });
    let businessesPurged = 0;
    for (const { id } of expiredBusinesses) {
      if (await this.purgeBusiness(id)) businessesPurged++;
    }

    this.logger.log(
      `Mantenimiento de cuentas: ${deletionsProcessed} eliminaciones, ${inactiveAnonymized} cuentas inactivas anonimizadas, ${transfersExpired} transferencias vencidas, ${businessesPurged} negocios eliminados`,
    );
    return {
      deletionsProcessed,
      inactiveAnonymized,
      transfersExpired,
      businessesPurged,
    };
  }

  /**
   * Elimina todos los datos de un negocio cerrado o inactivo: clientes,
   * deudas, pagos, invitaciones, miembros y transferencias. También borra
   * los registros de auditoría de esos datos, porque guardan información de
   * los clientes (nombre, documento, teléfono). Se conservan solo el registro
   * de las descargas del dueño y el de esta eliminación.
   */
  async purgeBusiness(businessId: string): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const business = await tx.business.findUnique({
          where: { id: businessId },
          select: { inactivatedAt: true },
        });
        if (!business?.inactivatedAt) return false;

        const where = { businessId };
        const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
        const [debtors, debts, payments, groups, invitations, members] = [
          ids(await tx.debtor.findMany({ where, select: { id: true } })),
          ids(await tx.debt.findMany({ where, select: { id: true } })),
          ids(await tx.payment.findMany({ where, select: { id: true } })),
          ids(await tx.paymentGroup.findMany({ where, select: { id: true } })),
          ids(await tx.invitation.findMany({ where, select: { id: true } })),
          ids(await tx.businessUser.findMany({ where, select: { id: true } })),
        ];

        // En orden: cada tabla antes de las que referencia.
        await tx.payment.deleteMany({ where });
        await tx.paymentGroup.deleteMany({ where });
        await tx.debt.deleteMany({ where });
        await tx.invitation.deleteMany({ where });
        await tx.debtor.deleteMany({ where });
        await tx.businessUser.deleteMany({ where });
        await tx.businessOwnershipTransfer.deleteMany({ where });
        await tx.auditLog.deleteMany({
          where: {
            entityId: {
              in: [
                businessId,
                ...debtors,
                ...debts,
                ...payments,
                ...groups,
                ...invitations,
                ...members,
              ],
            },
            action: {
              notIn: [
                AuditAction.BUSINESS_DATA_EXPORTED,
                AuditAction.BUSINESS_PURGED,
              ],
            },
          },
        });
        await tx.business.delete({ where: { id: businessId } });
        await tx.auditLog.create({
          data: {
            action: AuditAction.BUSINESS_PURGED,
            entity: 'Business',
            entityId: businessId,
            meta: {
              debtors: debtors.length,
              debts: debts.length,
              payments: payments.length,
              inactivatedAt: business.inactivatedAt.toISOString(),
            },
          },
        });
        return true;
      },
      { timeout: 60_000 },
    );
  }

  // ---------------------------------------------------------- utilidades

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.requireUser(userId);
    if (!user.password || !(await bcrypt.compare(password, user.password))) {
      throw new BadRequestException('La contraseña no es correcta');
    }
  }

  private async activeOwnedBusinesses(
    userId: string,
  ): Promise<OwnedBusinessSummaryDto[]> {
    const businesses = await this.prisma.business.findMany({
      where: { ownerId: userId, inactivatedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { debtors: { where: { inactivatedAt: null } } } },
        businessUsers: {
          where: {
            userId: { not: userId },
            user: { inactivatedAt: null, anonymizedAt: null },
          },
          select: {
            role: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        ownershipTransfers: {
          where: {
            status: OwnershipTransferStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, toUserId: true, expiresAt: true },
          take: 1,
        },
      },
    });

    return Promise.all(
      businesses.map(async (business) => {
        const { _sum } = await this.prisma.debt.aggregate({
          where: {
            businessId: business.id,
            status: { in: [DebtStatus.OPEN, DebtStatus.PARTIAL] },
          },
          _sum: { balance: true },
        });
        return {
          id: business.id,
          name: business.name,
          debtorsCount: business._count.debtors,
          pendingBalance: _sum.balance?.toNumber() ?? 0,
          transferCandidates: business.businessUsers.map((member) => ({
            userId: member.user.id,
            firstName: member.user.firstName,
            lastName: member.user.lastName,
            role: member.role,
          })),
          pendingTransfer: business.ownershipTransfers[0] ?? null,
          lastExportedAt:
            (
              await this.prisma.auditLog.findFirst({
                where: {
                  entity: 'Business',
                  entityId: business.id,
                  action: AuditAction.BUSINESS_DATA_EXPORTED,
                },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
              })
            )?.createdAt ?? null,
        };
      }),
    );
  }
}

/** Fecha legible en hora de Colombia, por ejemplo "3 de noviembre de 2026". */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'long',
    timeZone: 'America/Bogota',
  }).format(date);
}
