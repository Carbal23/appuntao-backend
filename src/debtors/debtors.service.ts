import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDebtorDto } from './dto/create-debtor.dto';
import { UpdateDebtorDto } from './dto/update-debtor.dto';
import { DebtStatus, Debtor, Prisma } from '@prisma/client';
import { userSafeSelect } from 'src/users/user.select';
import { debtSelect } from 'src/debts/debt.select';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { DebtorQueryDto } from './dto/debtor-query.dto';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { buildOrder } from 'src/common/pagination/utils/build-order.util';
import { buildDebtorWhere } from './utils/build-debtor-where.util';

@Injectable()
export class DebtorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    businessId: string,
    currentUserId: string,
    data: CreateDebtorDto,
  ): Promise<Debtor> {
    // Validar duplicado dentro del mismo negocio
    const existingDebtor = await this.prisma.debtor.findFirst({
      where: {
        businessId,
        OR: [
          { documentNumber: data.documentNumber ?? undefined },
          { phone: data.phone ?? undefined },
        ],
      },
    });

    if (existingDebtor) {
      throw new BadRequestException(
        'Ya existe un deudor con estos datos en este negocio.',
      );
    }

    const debtor = await this.prisma.debtor.create({
      // No se vincula a ningún usuario por coincidencia de teléfono o
      // documento: el vínculo solo se crea cuando el cliente acepta una
      // invitación del negocio (POST /invitations/accept).
      data: {
        ...data,
        businessId,
      },
    });

    await this.auditService.log({
      userId: currentUserId,
      action: AuditAction.DEBTOR_CREATED,
      entity: 'Debtor',
      entityId: debtor.id,
      meta: {
        debtorId: debtor.id,
        name: data.name,
        documentNumber: data.documentNumber,
        phone: data.phone,
        businessId,
      },
    });

    return debtor;
  }

  async findAll(businessId: string, query: DebtorQueryDto) {
    const { page = 1, limit = 10, search, sortBy, order, hasDebt } = query;

    const where = buildDebtorWhere({ businessId }, search, hasDebt);

    const result = await paginate(
      this.prisma.debtor,
      {
        where,
        include: {
          user: { select: userSafeSelect },
          debts: {
            where: {
              status: {
                in: ['OPEN', 'PARTIAL'],
              },
            },
            select: {
              balance: true,
            },
          },
        },
        orderBy: buildOrder(sortBy, order),
      },
      { page, limit },
    );

    const data = result.data as Array<
      Debtor & {
        debts: { balance: Prisma.Decimal }[];
      }
    >;

    return {
      ...result,
      data: data.map(({ debts, ...debtor }) => {
        const totalBalance = debts.reduce(
          (acc, debt) => acc + debt.balance.toNumber(),
          0,
        );

        return {
          ...debtor,
          totalBalance,
          hasPendingDebt: totalBalance > 0,
        };
      }),
    };
  }

  async getSummary(businessId: string, top = 5) {
    const openDebts = {
      status: { in: [DebtStatus.OPEN, DebtStatus.PARTIAL] },
    };
    const scope = { businessId, ...openDebts, debtor: { inactivatedAt: null } };

    /**
     * El ranking se ordena por la suma de saldos en la base de datos. Si se
     * ordenara en el móvil sobre una página, un moroso antiguo que no cabe en
     * esa página nunca saldría en la lista.
     *
     * Con `top = 0` quien llama solo quiere los totales (la lista de clientes
     * lo usa para los contadores de sus chips), así que se ahorra la
     * agrupación entera. El tipo va explícito porque el ternario, dentr
     * o del
     * `Promise.all`, degradaba la tupla a `any`.
     */
    type RankingEntry = {
      debtorId: string;
      _sum: { balance: Prisma.Decimal | null };
    };

    const rankingQuery =
      top > 0
        ? this.prisma.debt.groupBy({
            by: ['debtorId'],
            where: scope,
            _sum: { balance: true },
            orderBy: { _sum: { balance: 'desc' } },
            take: top,
          })
        : Promise.resolve<RankingEntry[]>([]);

    const [balance, totalDebtors, debtorsWithDebt, ranking] = await Promise.all(
      [
        this.prisma.debt.aggregate({
          _sum: { balance: true },
          where: scope,
        }),
        this.prisma.debtor.count({
          where: { businessId, inactivatedAt: null },
        }),
        this.prisma.debtor.count({
          where: {
            businessId,
            inactivatedAt: null,
            debts: { some: { ...openDebts, balance: { gt: 0 } } },
          },
        }),
        rankingQuery,
      ],
    );

    // `groupBy` solo devuelve ids; hay que traer los datos para pintarlos.
    const rows = ranking.length
      ? await this.prisma.debtor.findMany({
          where: { id: { in: ranking.map((entry) => entry.debtorId) } },
          include: { user: { select: userSafeSelect } },
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));

    const topDebtors = ranking.flatMap((entry) => {
      const debtor = byId.get(entry.debtorId);
      if (!debtor) return [];
      const totalBalance = entry._sum.balance?.toNumber() ?? 0;
      return [{ ...debtor, totalBalance, hasPendingDebt: totalBalance > 0 }];
    });

    return {
      totalBalance: balance._sum.balance?.toNumber() ?? 0,
      totalDebtors,
      debtorsWithDebt,
      debtorsClear: totalDebtors - debtorsWithDebt,
      topDebtors,
    };
  }

  /**
   * Las deudas de una ficha vinculada a la cuenta del usuario (modo cliente).
   *
   * Solo responde si la ficha es suya (`Debtor.userId`), está activa y su
   * negocio también. No exige ser miembro del negocio: el cliente no lo es.
   * Si la ficha no es suya responde 404, para no revelar que existe.
   *
   * Devuelve todas las deudas con sus pagos, sin paginar: la app suma el
   * saldo con ellas y una página de 10 lo dejaba incompleto.
   */
  async findMyDebts(userId: string, debtorId: string) {
    const debtor = await this.prisma.debtor.findFirst({
      where: {
        id: debtorId,
        userId,
        inactivatedAt: null,
        business: { inactivatedAt: null },
      },
      select: { id: true, businessId: true },
    });
    if (!debtor) throw new NotFoundException('Cuenta no encontrada');

    return this.prisma.debt.findMany({
      where: { debtorId: debtor.id, businessId: debtor.businessId },
      select: debtSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllByUser(userId: string, query: DebtorQueryDto) {
    const { page = 1, limit = 10, search, sortBy, order, hasDebt } = query;

    const memberships = await this.prisma.businessUser.findMany({
      where: { userId },
      select: { businessId: true },
    });

    const businessIds = memberships.map((m) => m.businessId);

    if (!businessIds.length) {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      };
    }

    const where = buildDebtorWhere(
      { businessId: { in: businessIds } },
      search,
      hasDebt,
    );

    const result = await paginate(
      this.prisma.debtor,
      {
        where,
        include: {
          business: {
            select: { id: true, name: true },
          },
          user: { select: userSafeSelect },
          debts: {
            where: {
              status: {
                in: ['OPEN', 'PARTIAL'],
              },
            },
            select: {
              balance: true,
            },
          },
        },
        orderBy: buildOrder(sortBy, order),
      },
      { page, limit },
    );

    const data = result.data as Array<
      Debtor & {
        debts: { balance: Prisma.Decimal }[];
      }
    >;

    return {
      ...result,
      data: data.map(({ debts, ...debtor }) => {
        const totalBalance = debts.reduce(
          (acc, debt) => acc + debt.balance.toNumber(),
          0,
        );

        return {
          ...debtor,
          totalBalance,
          hasPendingDebt: totalBalance > 0,
        };
      }),
    };
  }

  async findOne(id: string, businessId: string): Promise<Debtor> {
    const debtor = await this.prisma.debtor.findUnique({
      where: { id, businessId },
      include: {
        business: { select: { id: true, name: true } },
        user: { select: userSafeSelect },
        debts: true,
      },
    });

    if (!debtor) throw new NotFoundException('Deudor no encontrado');

    if (debtor.inactivatedAt)
      throw new NotFoundException('Deudor se encuentra inactivo');

    return debtor;
  }

  async update(
    id: string,
    businessId: string,
    currentUserId: string,
    data: UpdateDebtorDto,
  ): Promise<Debtor> {
    const debtor = await this.prisma.debtor.findUnique({
      where: { id, businessId },
    });
    if (!debtor) throw new NotFoundException('Deudor no encontrado');

    if (debtor.inactivatedAt)
      throw new NotFoundException('Deudor se encuentra inactivo');

    if (debtor.businessId !== businessId) {
      throw new NotFoundException('Deudor no encontrado en este negocio');
    }

    const updated = await this.prisma.debtor.update({
      where: { id },
      data,
    });

    await this.auditService.log({
      userId: currentUserId,
      action: AuditAction.DEBTOR_UPDATED,
      entity: 'Debtor',
      entityId: debtor.id,
      meta: {
        debtorId: debtor.id,
        previousName: debtor.name,
        newName: updated.name,
        previousDocumentNumber: debtor.documentNumber,
        newDocumentNumber: updated.documentNumber,
        previousPhone: debtor.phone,
        newPhone: updated.phone,
        businessId: debtor.businessId,
      },
    });

    return updated;
  }

  async inactivate(
    id: string,
    businessId: string,
    currentUserId: string,
  ): Promise<{ message: string }> {
    const debtor = await this.prisma.debtor.findUnique({
      where: { id, businessId },
      include: {
        debts: {
          where: {
            status: { in: [DebtStatus.OPEN, DebtStatus.PARTIAL] },
            balance: {
              gt: 0,
            },
          },
          select: { id: true },
        },
      },
    });

    if (!debtor) throw new NotFoundException('Deudor no encontrado');

    if (debtor.inactivatedAt)
      throw new NotFoundException('Deudor se encuentra inactivo');

    if (debtor.debts.length > 0) {
      throw new BadRequestException(
        'No se puede inactivar un deudor con saldo pendiente. Registra el pago o cancela sus deudas primero.',
      );
    }

    await this.prisma.debtor.update({
      where: { id },
      data: {
        inactivatedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId: currentUserId,
      action: AuditAction.DEBTOR_INACTIVATED,
      entity: 'Debtor',
      entityId: debtor.id,
      meta: {
        debtorId: debtor.id,
        businessId: debtor.businessId,
      },
    });

    return { message: 'Deudor quedo inactivo correctamente' };
  }

  /**
   * El negocio desvincula la ficha de la cuenta que la veía (por ejemplo, si
   * aceptó la persona equivocada). La cuenta deja de ver la tienda en el modo
   * cliente; la ficha, sus deudas y sus pagos siguen iguales. Para volver a
   * vincularla hay que invitar de nuevo.
   */
  async unlinkByBusiness(id: string, businessId: string, actorId: string) {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id, businessId },
      select: { id: true, userId: true },
    });
    if (!debtor) throw new NotFoundException('Deudor no encontrado');
    if (!debtor.userId) {
      throw new ConflictException(
        'Este cliente no está vinculado a ninguna cuenta',
      );
    }

    await this.prisma.debtor.update({
      where: { id },
      data: { userId: null },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.DEBTOR_UNLINKED,
      entity: 'Debtor',
      entityId: id,
      meta: { businessId, previousUserId: debtor.userId, by: 'BUSINESS' },
    });

    return { message: 'Cliente desvinculado: ya no ve su cuenta en la app' };
  }

  /**
   * El cliente deja de ver una tienda en el modo cliente. Es su decisión: la
   * tienda conserva la ficha y sus deudas, y puede invitarlo de nuevo.
   * Responde 404 si la ficha no está ligada a su cuenta.
   */
  async unlinkByClient(userId: string, debtorId: string) {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id: debtorId, userId },
      select: { id: true, businessId: true },
    });
    if (!debtor) throw new NotFoundException('Cuenta no encontrada');

    await this.prisma.debtor.update({
      where: { id: debtor.id },
      data: { userId: null },
    });

    await this.auditService.log({
      userId,
      action: AuditAction.DEBTOR_UNLINKED,
      entity: 'Debtor',
      entityId: debtor.id,
      meta: {
        businessId: debtor.businessId,
        previousUserId: userId,
        by: 'CLIENT',
      },
    });

    return { message: 'Ya no verás esta tienda en tu cuenta' };
  }
}
