import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDebtorDto } from './dto/create-debtor.dto';
import { UpdateDebtorDto } from './dto/update-debtor.dto';
import {
  DebtStatus,
  Debtor,
  InvitationStatus,
  InvitationType,
  Prisma,
} from '@prisma/client';
import { debtSelect } from 'src/debts/debt.select';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { DebtorQueryDto } from './dto/debtor-query.dto';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { buildOrder } from 'src/common/pagination/utils/build-order.util';
import { buildDebtorWhere } from './utils/build-debtor-where.util';
import {
  documentNumberError,
  normalizeDocumentNumber,
} from 'src/common/validation/contact.validators';

/**
 * De la cuenta vinculada, el negocio solo ve el nombre. Antes recibía el
 * correo, el teléfono, el documento y el rol global de la cuenta, datos que
 * el cliente no le entregó al negocio al aceptar la invitación.
 */
const linkedUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

const OPEN_STATUSES: DebtStatus[] = [DebtStatus.OPEN, DebtStatus.PARTIAL];

/** Deudas que suman al saldo del deudor. */
const openDebtsWhere = {
  status: { in: OPEN_STATUSES },
  balance: { gt: 0 },
} satisfies Prisma.DebtWhereInput;

/** Suma los saldos en `Decimal` y convierte una sola vez, sin errores de coma flotante. */
const sumBalances = (debts: { balance: Prisma.Decimal }[]): number =>
  debts
    .reduce((acc, debt) => acc.add(debt.balance), new Prisma.Decimal(0))
    .toNumber();

type DebtorRow = Debtor & { debts: { balance: Prisma.Decimal }[] };

type DuplicateField = 'phone' | 'documentNumber';

@Injectable()
export class DebtorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Busca otro deudor **activo** del negocio con el mismo teléfono o
   * documento. Solo arma el `OR` con los datos que vienen, en vez de pasarle
   * `undefined` a Prisma y depender de cómo lo interpreta.
   *
   * Los inactivos no cuentan: no se pueden reactivar, y sin esto la persona
   * no se podría volver a registrar nunca.
   */
  private async assertNoDuplicate(
    businessId: string,
    data: { phone?: string | null; documentNumber?: string | null },
    excludeId?: string,
  ) {
    const conditions: Prisma.DebtorWhereInput[] = [];
    if (data.phone) conditions.push({ phone: data.phone });
    if (data.documentNumber) {
      conditions.push({ documentNumber: data.documentNumber });
    }
    if (!conditions.length) return;

    const existing = await this.prisma.debtor.findFirst({
      where: {
        businessId,
        inactivatedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: conditions,
      },
      select: { id: true, phone: true, documentNumber: true },
    });
    if (!existing) return;

    const field: DuplicateField =
      data.documentNumber && existing.documentNumber === data.documentNumber
        ? 'documentNumber'
        : 'phone';
    const fieldMessage =
      field === 'documentNumber'
        ? 'Ya tienes otro cliente con este documento'
        : 'Ya tienes otro cliente con este celular';

    throw new ConflictException({
      statusCode: 409,
      error: 'DEBTOR_DUPLICATE',
      message: `${fieldMessage} en este negocio.`,
      errors: { [field]: fieldMessage },
      debtorId: existing.id,
    });
  }

  async create(
    businessId: string,
    currentUserId: string,
    data: CreateDebtorDto,
  ): Promise<Debtor> {
    await this.assertNoDuplicate(businessId, data);

    return this.prisma.$transaction(async (tx) => {
      const debtor = await tx.debtor.create({
        // No se vincula a ningún usuario por coincidencia de teléfono o
        // documento: el vínculo solo se crea cuando el cliente acepta una
        // invitación del negocio (POST /invitations/accept).
        data: {
          ...data,
          businessId,
        },
      });

      await this.auditService.log(
        {
          userId: currentUserId,
          action: AuditAction.DEBTOR_CREATED,
          entity: 'Debtor',
          entityId: debtor.id,
          meta: {
            debtorId: debtor.id,
            name: data.name,
            documentNumber: data.documentNumber ?? null,
            phone: data.phone ?? null,
            businessId,
          },
        },
        tx,
      );

      return debtor;
    });
  }

  async findAll(businessId: string, query: DebtorQueryDto) {
    const { page = 1, limit = 10, search, sortBy, order, hasDebt } = query;

    const where = buildDebtorWhere({ businessId }, search, hasDebt);

    const result = await paginate(
      this.prisma.debtor,
      {
        where,
        include: {
          user: { select: linkedUserSelect },
          debts: { where: openDebtsWhere, select: { balance: true } },
        },
        orderBy: buildOrder(sortBy, order),
      },
      { page, limit },
    );

    return { ...result, data: this.withBalance(result.data as DebtorRow[]) };
  }

  async getSummary(businessId: string, top = 5) {
    const scope = {
      businessId,
      ...openDebtsWhere,
      debtor: { inactivatedAt: null },
    } satisfies Prisma.DebtWhereInput;

    /**
     * El ranking se ordena por la suma de saldos en la base de datos. Si se
     * ordenara en el móvil sobre una página, un moroso antiguo que no cabe en
     * esa página nunca saldría en la lista.
     *
     * Con `top = 0` quien llama solo quiere los totales (la lista de clientes
     * lo usa para los contadores de sus chips), así que se ahorra la
     * agrupación entera. El tipo va explícito porque el ternario, dentro del
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
            debts: { some: openDebtsWhere },
          },
        }),
        rankingQuery,
      ],
    );

    // `groupBy` solo devuelve ids; hay que traer los datos para pintarlos.
    const rows = ranking.length
      ? await this.prisma.debtor.findMany({
          where: {
            id: { in: ranking.map((entry) => entry.debtorId) },
            businessId,
          },
          include: { user: { select: linkedUserSelect } },
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

  /**
   * Los deudores de todos los negocios activos en los que el usuario trabaja
   * (cualquier rol). Los negocios cerrados no aparecen, igual que en el
   * dashboard.
   */
  async findAllByUser(userId: string, query: DebtorQueryDto) {
    const { page = 1, limit = 10, search, sortBy, order, hasDebt } = query;

    const memberships = await this.prisma.businessUser.findMany({
      where: { userId, business: { inactivatedAt: null } },
      select: { businessId: true },
    });

    const businessIds = memberships.map((m) => m.businessId);

    if (!businessIds.length) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
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
          business: { select: { id: true, name: true } },
          user: { select: linkedUserSelect },
          debts: { where: openDebtsWhere, select: { balance: true } },
        },
        orderBy: buildOrder(sortBy, order),
      },
      { page, limit },
    );

    return { ...result, data: this.withBalance(result.data as DebtorRow[]) };
  }

  /**
   * Detalle de un deudor activo del negocio, con su saldo calculado igual que
   * en el listado y **todas** sus deudas con sus pagos, de la más reciente a
   * la más antigua, en el mismo formato de `GET /debtors/:id/debts`.
   *
   * Van sin paginar porque la app saca de ellas el saldo, los totales y el
   * extracto: con la página de 10 de `/debtors/:id/debts`, un cliente con más
   * de 10 deudas mostraba un saldo menor que el real.
   */
  async findOne(id: string, businessId: string) {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id, businessId },
      include: {
        business: { select: { id: true, name: true } },
        user: { select: linkedUserSelect },
        debts: { select: debtSelect, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!debtor) throw new NotFoundException('Deudor no encontrado');

    if (debtor.inactivatedAt)
      throw new NotFoundException('Deudor se encuentra inactivo');

    const totalBalance = sumBalances(
      debtor.debts.filter(
        (debt) => OPEN_STATUSES.includes(debt.status) && debt.balance.gt(0),
      ),
    );

    return { ...debtor, totalBalance, hasPendingDebt: totalBalance > 0 };
  }

  async update(
    id: string,
    businessId: string,
    currentUserId: string,
    data: UpdateDebtorDto,
  ): Promise<Debtor> {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id, businessId },
    });
    if (!debtor) throw new NotFoundException('Deudor no encontrado');

    if (debtor.inactivatedAt)
      throw new NotFoundException('Deudor se encuentra inactivo');

    // `PartialType` vuelve opcional el nombre, y `IsOptional` deja pasar
    // `null`: llegaba a Prisma y respondía 500.
    if (data.name === null || data.name === '') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'El nombre no puede estar vacío',
        errors: { name: 'El nombre no puede estar vacío' },
      });
    }

    /**
     * La regla del número depende del tipo, y al editar pueden llegar por
     * separado. Se valida la pareja como queda al guardar; si solo cambió el
     * tipo, el número guardado se normaliza con la regla del tipo nuevo.
     */
    const changes: Prisma.DebtorUpdateInput = { ...data };
    const typeChanged = data.documentType !== undefined;
    const numberChanged = data.documentNumber !== undefined;
    if (typeChanged || numberChanged) {
      const finalType = typeChanged ? data.documentType : debtor.documentType;
      const rawNumber = numberChanged
        ? data.documentNumber
        : debtor.documentNumber;
      const finalNumber =
        rawNumber == null
          ? rawNumber
          : (normalizeDocumentNumber(rawNumber, finalType) as string);

      const error = documentNumberError(finalType, finalNumber);
      if (error) {
        throw new BadRequestException({
          statusCode: 400,
          message: error,
          errors: { documentNumber: error },
        });
      }
      if (finalNumber !== debtor.documentNumber) {
        changes.documentNumber = finalNumber;
      }
    }

    await this.assertNoDuplicate(
      businessId,
      {
        phone: data.phone !== debtor.phone ? data.phone : undefined,
        documentNumber:
          changes.documentNumber !== undefined &&
          changes.documentNumber !== debtor.documentNumber
            ? (changes.documentNumber as string | null)
            : undefined,
      },
      id,
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.debtor.update({
        where: { id },
        data: changes,
      });

      await this.auditService.log(
        {
          userId: currentUserId,
          action: AuditAction.DEBTOR_UPDATED,
          entity: 'Debtor',
          entityId: debtor.id,
          meta: {
            debtorId: debtor.id,
            previousName: debtor.name,
            newName: updated.name,
            previousDocumentType: debtor.documentType,
            newDocumentType: updated.documentType,
            previousDocumentNumber: debtor.documentNumber,
            newDocumentNumber: updated.documentNumber,
            previousPhone: debtor.phone,
            newPhone: updated.phone,
            businessId: debtor.businessId,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Inactiva un deudor sin saldo pendiente. En la misma transacción:
   *
   * - se suelta la cuenta vinculada: la ficha inactiva ya no se le mostraba,
   *   pero seguía contando como "ya eres cliente de este negocio" y bloqueaba
   *   invitarla desde una ficha nueva;
   * - se cancelan sus invitaciones pendientes.
   *
   * El `updateMany` condicionado evita que una deuda creada entre la consulta
   * y la escritura deje inactivo a alguien que debe.
   */
  async inactivate(
    id: string,
    businessId: string,
    currentUserId: string,
  ): Promise<{ message: string }> {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id, businessId },
      select: { id: true, userId: true, inactivatedAt: true },
    });

    if (!debtor) throw new NotFoundException('Deudor no encontrado');

    if (debtor.inactivatedAt)
      throw new NotFoundException('Deudor se encuentra inactivo');

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.debtor.updateMany({
        where: {
          id,
          businessId,
          inactivatedAt: null,
          debts: { none: openDebtsWhere },
        },
        data: { inactivatedAt: new Date(), userId: null },
      });
      if (count === 0) {
        throw new BadRequestException(
          'No se puede inactivar un deudor con saldo pendiente. Registra el pago o cancela sus deudas primero.',
        );
      }

      const cancelled = await tx.invitation.updateMany({
        where: {
          debtorId: id,
          type: InvitationType.DEBTOR,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.CANCELLED, respondedAt: new Date() },
      });

      await this.auditService.log(
        {
          userId: currentUserId,
          action: AuditAction.DEBTOR_INACTIVATED,
          entity: 'Debtor',
          entityId: debtor.id,
          meta: {
            debtorId: debtor.id,
            businessId,
            previousUserId: debtor.userId,
            cancelledInvitations: cancelled.count,
          },
        },
        tx,
      );
    });

    return { message: 'El deudor quedó inactivo' };
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

    await this.prisma.$transaction(async (tx) => {
      await tx.debtor.update({
        where: { id },
        data: { userId: null },
      });
      await this.auditService.log(
        {
          userId: actorId,
          action: AuditAction.DEBTOR_UNLINKED,
          entity: 'Debtor',
          entityId: id,
          meta: { businessId, previousUserId: debtor.userId, by: 'BUSINESS' },
        },
        tx,
      );
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

    await this.prisma.$transaction(async (tx) => {
      await tx.debtor.update({
        where: { id: debtor.id },
        data: { userId: null },
      });
      await this.auditService.log(
        {
          userId,
          action: AuditAction.DEBTOR_UNLINKED,
          entity: 'Debtor',
          entityId: debtor.id,
          meta: {
            businessId: debtor.businessId,
            previousUserId: userId,
            by: 'CLIENT',
          },
        },
        tx,
      );
    });

    return { message: 'Ya no verás esta tienda en tu cuenta' };
  }

  /** Agrega `totalBalance` y `hasPendingDebt` y quita las deudas de la respuesta. */
  private withBalance(rows: DebtorRow[]) {
    return rows.map(({ debts, ...debtor }) => {
      const totalBalance = sumBalances(debts);
      return { ...debtor, totalBalance, hasPendingDebt: totalBalance > 0 };
    });
  }
}
