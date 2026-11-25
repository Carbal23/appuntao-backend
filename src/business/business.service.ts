import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { QueryBusinessDto } from './dto/query-business.dto';
import {
  BusinessUserRole,
  DebtStatus,
  InvitationStatus,
  LegalAudience,
  OwnershipTransferStatus,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { buildWhere } from 'src/common/pagination/utils/build-where.util';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { LegalService } from 'src/legal/legal.service';
import type { RequestContext } from 'src/auth-log/auth-log.types';
import { assertCanOwnAnotherBusiness } from './business-cap';

const memberSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} satisfies Prisma.UserSelect;

type LockedBusiness = {
  id: string;
  ownerId: string;
  name: string;
  address: string | null;
  inactivatedAt: Date | null;
};

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
    private readonly legalService: LegalService,
  ) {}

  async create(
    createBusinessDto: CreateBusinessDto,
    userId: string,
    context?: RequestContext,
  ) {
    const { acceptedLegalDocumentIds = [], ...businessData } =
      createBusinessDto;

    // Quien crea un negocio pasa a ser Responsable de los datos de sus
    // clientes: antes tiene que aceptar los documentos para negocios.
    await this.legalService.assertAcceptsCurrent(
      acceptedLegalDocumentIds,
      LegalAudience.BUSINESS_OWNERS,
      userId,
    );

    return this.prisma.$transaction(async (tx) => {
      await assertCanOwnAnotherBusiness(tx, userId);

      const business = await tx.business.create({
        data: {
          ...businessData,
          ownerId: userId,
        },
      });

      await this.legalService.recordConsents(
        tx,
        userId,
        acceptedLegalDocumentIds,
        context,
      );

      await tx.businessUser.create({
        data: {
          businessId: business.id,
          userId,
          role: BusinessUserRole.OWNER,
        },
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.BUSINESS_CREATED,
          entity: 'Business',
          entityId: business.id,
          meta: {
            businessName: business.name,
            address: business.address,
          },
        },
        tx,
      );

      return business;
    });
  }

  async findAllByUser(userId: string, query: QueryBusinessDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const where = buildWhere({
      search,
      searchFields: ['name'],
      filters: {
        // Un negocio cerrado no se lista aquí: la guardia de negocio ya
        // rechaza cualquier operación sobre él. Su dueño lo ve en
        // GET /business/closed, donde puede descargarlo o reabrirlo.
        inactivatedAt: null,
        OR: [{ ownerId: userId }, { businessUsers: { some: { userId } } }],
      },
    });

    return paginate(
      this.prisma.business,
      {
        where,
        include: {
          businessUsers: {
            include: { user: { select: memberSelect } },
          },
        },
        orderBy: [{ [sortBy]: order }, { id: 'asc' }],
      },
      { page, limit },
    );
  }

  /**
   * Los negocios cerrados del usuario como dueño, con la fecha en que se
   * eliminan sus datos. Mientras tanto puede descargarlos o reabrirlos.
   */
  async findClosedByOwner(userId: string) {
    const businesses = await this.prisma.business.findMany({
      where: { ownerId: userId, inactivatedAt: { not: null } },
      select: {
        id: true,
        name: true,
        address: true,
        currency: true,
        createdAt: true,
        inactivatedAt: true,
      },
      orderBy: { inactivatedAt: 'desc' },
    });

    return businesses.map((business) => {
      const dataDeletionScheduledAt = this.deletionDate(
        business.inactivatedAt!,
      );
      return {
        ...business,
        dataDeletionScheduledAt,
        canReactivate: dataDeletionScheduledAt > new Date(),
      };
    });
  }

  async findOne(id: string, userId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: {
        businessUsers: {
          include: { user: { select: memberSelect } },
        },
      },
    });

    if (!business) throw new NotFoundException('Negocio no encontrado');

    if (business.inactivatedAt)
      throw new BadRequestException('Negocio inactivado');

    const isMember =
      business.ownerId === userId ||
      business.businessUsers.some((u) => u.userId === userId);
    if (!isMember)
      throw new ForbiddenException('No tienes acceso a este negocio');

    return business;
  }

  async update(id: string, dto: UpdateBusinessDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const business = await this.lockOwned(tx, id, userId, 'actualizar');
      if (business.inactivatedAt)
        throw new BadRequestException(
          'No puedes modificar un negocio inactivado',
        );

      // Solo lo que de verdad cambia: así la auditoría dice qué había antes.
      const changes: Prisma.BusinessUpdateInput = {};
      const meta: Record<string, string | null> = {};
      if (dto.name !== undefined && dto.name !== business.name) {
        changes.name = dto.name;
        meta.previousBusinessName = business.name;
        meta.newBusinessName = dto.name;
      }
      if (dto.address !== undefined && dto.address !== business.address) {
        changes.address = dto.address;
        meta.previousAddress = business.address;
        meta.newAddress = dto.address;
      }

      if (Object.keys(changes).length === 0) {
        return tx.business.findUniqueOrThrow({ where: { id } });
      }

      const updated = await tx.business.update({
        where: { id },
        data: changes,
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.BUSINESS_UPDATED,
          entity: 'Business',
          entityId: id,
          meta,
        },
        tx,
      );

      return updated;
    });
  }

  async inactivate(id: string, userId: string) {
    const inactivatedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // El bloqueo frena a quien esté fiando en este momento: crear una deuda
      // toma el mismo negocio con FOR SHARE, así que espera a que esto
      // termine y, ya cerrado, se rechaza.
      const business = await this.lockOwned(tx, id, userId, 'inactivar');
      if (business.inactivatedAt) {
        throw new BadRequestException('El negocio ya está inactivo');
      }

      const activeDebts = await tx.debt.count({
        where: {
          businessId: id,
          status: { in: [DebtStatus.OPEN, DebtStatus.PARTIAL] },
        },
      });
      if (activeDebts > 0) {
        throw new BadRequestException(
          `No puedes inactivar un negocio con deudas activas: ${
            activeDebts === 1
              ? 'queda 1 deuda por cobrar'
              : `quedan ${activeDebts} deudas por cobrar`
          }`,
        );
      }

      await tx.business.update({
        where: { id },
        data: { inactivatedAt },
      });

      // Lo pendiente del negocio ya no se puede responder.
      await tx.invitation.updateMany({
        where: { businessId: id, status: InvitationStatus.PENDING },
        data: {
          status: InvitationStatus.CANCELLED,
          respondedAt: inactivatedAt,
        },
      });
      await tx.businessOwnershipTransfer.updateMany({
        where: { businessId: id, status: OwnershipTransferStatus.PENDING },
        data: {
          status: OwnershipTransferStatus.CANCELLED,
          respondedAt: inactivatedAt,
        },
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.BUSINESS_DEACTIVATED,
          entity: 'Business',
          entityId: id,
        },
        tx,
      );
    });

    // Los datos de un negocio inactivo se eliminan pasado el plazo de
    // retención; hasta entonces el dueño puede descargarlos o reabrirlo.
    const dataDeletionScheduledAt = this.deletionDate(inactivatedAt);

    return {
      message: `Negocio inactivado correctamente. Su información se eliminará el ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(dataDeletionScheduledAt)}; hasta entonces puedes descargarla o reabrir el negocio.`,
      dataDeletionScheduledAt,
    };
  }

  /**
   * Reabre un negocio cerrado, mientras sus datos no se hayan eliminado. Todo
   * vuelve como estaba: clientes, deudas y equipo. Cuenta para el tope de
   * negocios activos.
   */
  async reactivate(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const business = await this.lockOwned(tx, id, userId, 'reabrir');
      if (!business.inactivatedAt) {
        throw new BadRequestException('El negocio ya está activo');
      }
      if (this.deletionDate(business.inactivatedAt) <= new Date()) {
        throw new BadRequestException(
          'Venció el plazo para reabrir este negocio: su información se va a eliminar',
        );
      }

      await assertCanOwnAnotherBusiness(tx, userId);

      const reactivated = await tx.business.update({
        where: { id },
        data: { inactivatedAt: null },
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.BUSINESS_REACTIVATED,
          entity: 'Business',
          entityId: id,
          meta: { inactivatedAt: business.inactivatedAt.toISOString() },
        },
        tx,
      );

      return reactivated;
    });
  }

  // ---------------------------------------------------------- utilidades

  /** Bloquea el negocio y valida que exista y que el usuario sea el dueño. */
  private async lockOwned(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    verb: string,
  ): Promise<LockedBusiness> {
    const [business] = await tx.$queryRaw<LockedBusiness[]>`
      SELECT id, "ownerId", name, address, "inactivatedAt"
      FROM "Business" WHERE id = ${id} FOR UPDATE`;
    if (!business) throw new NotFoundException('Negocio no encontrado');
    if (business.ownerId !== userId) {
      throw new ForbiddenException(
        `Solo el propietario puede ${verb} el negocio`,
      );
    }
    return business;
  }

  private deletionDate(inactivatedAt: Date): Date {
    const date = new Date(inactivatedAt);
    date.setUTCMonth(
      date.getUTCMonth() +
        this.config.getOrThrow<number>('account.closedBusinessRetentionMonths'),
    );
    return date;
  }
}
