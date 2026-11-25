import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DebtStatus, PaymentMethod, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateGlobalPaymentDto } from './dto/create-global-payment.dto';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { paymentSelect } from './payment.select';

type Tx = Prisma.TransactionClient;

const OPEN_STATUSES: DebtStatus[] = [DebtStatus.OPEN, DebtStatus.PARTIAL];

/**
 * Cómo mueve el saldo cada tipo:
 * - `PAYMENT` (abono) lo baja;
 * - `DISCOUNT` (descuento: lo que el negocio le perdona) lo baja;
 * - `REVERSAL` (reverso de un abono o un descuento) lo sube en lo mismo que
 *   había bajado el movimiento que deshace.
 *
 * Los montos se guardan siempre positivos; el signo lo pone el tipo.
 */
const SIGN: Record<PaymentType, 1 | -1> = {
  PAYMENT: -1,
  DISCOUNT: -1,
  REVERSAL: 1,
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Abono a una deuda. Dueño, administrador o cajero. */
  async create(dto: CreatePaymentDto, userId: string, businessId: string) {
    const { debtId, amount, method, note } = dto;

    return this.prisma.$transaction(async (tx) => {
      const debt = await this.lockOpenDebt(tx, debtId, businessId);
      const value = new Prisma.Decimal(amount);

      if (value.gt(debt.balance)) {
        throw new BadRequestException(
          `El abono no puede ser mayor al saldo de la deuda (${debt.balance.toString()})`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          debtId,
          businessId,
          amount: value,
          method,
          type: PaymentType.PAYMENT,
          note: note || null,
          createdBy: userId,
        },
        select: paymentSelect,
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.PAYMENT_CREATED,
          entity: 'Payment',
          entityId: payment.id,
          meta: {
            amount,
            method,
            debtId,
            debtorId: debt.debtorId,
            businessId,
          },
        },
        tx,
      );

      await this.recalculateDebtBalance(tx, debtId, userId, payment.id);

      return payment;
    });
  }

  /**
   * Descuento: el negocio le perdona al cliente parte o todo el saldo de una
   * deuda (por ejemplo, los 300 pesos que faltaban). Solo dueño y
   * administrador, con motivo, y nunca por más del saldo.
   */
  async createDiscount(
    dto: CreateDiscountDto,
    userId: string,
    businessId: string,
  ) {
    const { debtId, amount, reason } = dto;

    return this.prisma.$transaction(async (tx) => {
      const debt = await this.lockOpenDebt(tx, debtId, businessId);
      const value = new Prisma.Decimal(amount);

      if (value.gt(debt.balance)) {
        throw new BadRequestException(
          `El descuento no puede ser mayor al saldo de la deuda (${debt.balance.toString()})`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          debtId,
          businessId,
          amount: value,
          method: PaymentMethod.OTHER,
          type: PaymentType.DISCOUNT,
          note: reason,
          createdBy: userId,
        },
        select: paymentSelect,
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.PAYMENT_DISCOUNT,
          entity: 'Payment',
          entityId: payment.id,
          meta: {
            amount,
            reason,
            debtId,
            debtorId: debt.debtorId,
            businessId,
          },
        },
        tx,
      );

      await this.recalculateDebtBalance(tx, debtId, userId, payment.id);

      return payment;
    });
  }

  /**
   * Abono al saldo total del cliente: se reparte entre sus deudas abiertas,
   * de la más antigua a la más nueva.
   */
  async createGlobalPayment(
    dto: CreateGlobalPaymentDto,
    userId: string,
    businessId: string,
  ) {
    const { debtorId, amount, method, note } = dto;

    return this.prisma.$transaction(async (tx) => {
      const debtor = await tx.debtor.findFirst({
        where: { id: debtorId, businessId },
        select: { id: true, name: true },
      });
      if (!debtor) throw new NotFoundException('Deudor no encontrado');

      // Se bloquean en orden de id, igual que en los reversos: dos
      // transacciones que toman las mismas filas en el mismo orden esperan
      // una a la otra en lugar de trabarse.
      await tx.$queryRaw`
        SELECT id FROM "Debt"
        WHERE "debtorId" = ${debtorId}
          AND "businessId" = ${businessId}
          AND status IN ('OPEN', 'PARTIAL')
        ORDER BY id
        FOR UPDATE`;

      const debts = await tx.debt.findMany({
        where: {
          debtorId,
          businessId,
          status: { in: OPEN_STATUSES },
          balance: { gt: 0 },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      if (!debts.length) {
        throw new BadRequestException('El deudor no tiene deudas pendientes');
      }

      const totalDebt = debts.reduce(
        (acc, d) => acc.plus(d.balance),
        new Prisma.Decimal(0),
      );
      const total = new Prisma.Decimal(amount);

      if (total.gt(totalDebt)) {
        throw new BadRequestException(
          `El monto excede la deuda total (${totalDebt.toString()})`,
        );
      }

      const group = await tx.paymentGroup.create({
        data: {
          businessId,
          debtorId,
          totalAmount: total,
          createdBy: userId,
        },
      });

      let remaining = total;
      const applied: {
        paymentId: string;
        debtId: string;
        appliedAmount: number;
        previousBalance: number;
        newBalance: number;
        status: DebtStatus;
      }[] = [];

      for (const debt of debts) {
        if (remaining.lte(0)) break;

        const part = Prisma.Decimal.min(remaining, debt.balance);

        const payment = await tx.payment.create({
          data: {
            debtId: debt.id,
            businessId,
            amount: part,
            method,
            type: PaymentType.PAYMENT,
            note: note || null,
            createdBy: userId,
            paymentGroupId: group.id,
          },
          select: { id: true },
        });

        const result = await this.recalculateDebtBalance(
          tx,
          debt.id,
          userId,
          payment.id,
        );

        applied.push({
          paymentId: payment.id,
          debtId: debt.id,
          appliedAmount: part.toNumber(),
          previousBalance: debt.balance.toNumber(),
          newBalance: result.balance,
          status: result.status,
        });

        remaining = remaining.minus(part);
      }

      await this.auditService.log(
        {
          userId,
          action: AuditAction.PAYMENT_CREATED,
          entity: 'PaymentGroup',
          entityId: group.id,
          meta: {
            debtorId,
            totalAmount: amount,
            method,
            paymentsCount: applied.length,
            debtIds: applied.map((p) => p.debtId),
            businessId,
          },
        },
        tx,
      );

      return {
        message: 'Pago global aplicado',
        group: { id: group.id, totalAmount: amount },
        debtor: { id: debtor.id, name: debtor.name },
        summary: { totalApplied: amount, debtsAffected: applied.length },
        payments: applied,
      };
    });
  }

  /**
   * Reverso de un abono o un descuento suelto: crea un `REVERSAL` por el
   * mismo valor, enlazado al original (`reversedPaymentId`, único en la
   * base), así que cada movimiento se reversa una sola vez. Los abonos que
   * son parte de un pago global se reversan con el grupo completo.
   */
  async reversePayment(
    paymentId: string,
    dto: ReversePaymentDto,
    userId: string,
    businessId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.payment.findFirst({
        where: { id: paymentId, businessId },
        select: {
          id: true,
          debtId: true,
          amount: true,
          method: true,
          type: true,
          paymentGroupId: true,
          reversal: { select: { id: true } },
        },
      });
      if (!target) throw new NotFoundException('Pago no encontrado');

      if (target.type === PaymentType.REVERSAL) {
        throw new BadRequestException('Un reverso no se puede reversar');
      }
      if (target.paymentGroupId) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'PAYMENT_IN_GROUP',
          message:
            'Este abono es parte de un pago global: hay que reversar el pago completo',
          paymentGroupId: target.paymentGroupId,
        });
      }

      await this.lockDebts(tx, [target.debtId]);

      // Se vuelve a mirar ya con la deuda bloqueada: otro reverso del mismo
      // pago pudo terminar mientras se esperaba. El índice único de
      // `reversedPaymentId` es la última barrera.
      const already = await tx.payment.count({
        where: { reversedPaymentId: target.id },
      });
      if (target.reversal || already > 0) {
        throw new BadRequestException('Este movimiento ya fue reversado');
      }

      const label =
        target.type === PaymentType.DISCOUNT
          ? 'Reverso de descuento'
          : 'Reverso de abono';

      const reversal = await tx.payment.create({
        data: {
          debtId: target.debtId,
          businessId,
          amount: target.amount,
          method: target.method,
          type: PaymentType.REVERSAL,
          note: dto.reason ? `${label}: ${dto.reason}` : label,
          createdBy: userId,
          reversedPaymentId: target.id,
        },
        select: paymentSelect,
      });

      await this.auditService.log(
        {
          userId,
          action: AuditAction.PAYMENT_REVERSAL,
          entity: 'Payment',
          entityId: reversal.id,
          meta: {
            reversedPaymentId: target.id,
            reversedType: target.type,
            amount: target.amount.toNumber(),
            reason: dto.reason ?? null,
            debtId: target.debtId,
            businessId,
          },
        },
        tx,
      );

      await this.recalculateDebtBalance(tx, target.debtId, userId, reversal.id);

      return reversal;
    });
  }

  /** Reverso de un pago global completo. */
  async reversePaymentGroup(
    groupId: string,
    userId: string,
    businessId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Primero se reclama el grupo: de dos reversos simultáneos solo uno
      // cambia la fila, y el otro sale aquí sin haber creado nada.
      const claimed = await tx.paymentGroup.updateMany({
        where: { id: groupId, businessId, reversedAt: null },
        data: { reversedAt: new Date() },
      });

      if (claimed.count === 0) {
        const exists = await tx.paymentGroup.findFirst({
          where: { id: groupId, businessId },
          select: { id: true },
        });
        if (!exists) throw new NotFoundException('Pago global no encontrado');
        throw new BadRequestException('Este pago global ya fue reversado');
      }

      const payments = await tx.payment.findMany({
        where: { paymentGroupId: groupId, type: PaymentType.PAYMENT },
        select: { id: true, debtId: true, amount: true, method: true },
        orderBy: { id: 'asc' },
      });
      if (!payments.length) {
        throw new BadRequestException('No hay pagos para reversar');
      }

      const debtIds = [...new Set(payments.map((p) => p.debtId))];
      await this.lockDebts(tx, debtIds);

      for (const payment of payments) {
        await tx.payment.create({
          data: {
            debtId: payment.debtId,
            businessId,
            amount: payment.amount,
            method: payment.method,
            type: PaymentType.REVERSAL,
            note: 'Reverso de pago global',
            createdBy: userId,
            reversedPaymentId: payment.id,
          },
        });
      }

      const total = payments.reduce(
        (acc, p) => acc.plus(p.amount),
        new Prisma.Decimal(0),
      );

      await this.auditService.log(
        {
          userId,
          action: AuditAction.PAYMENT_REVERSAL,
          entity: 'PaymentGroup',
          entityId: groupId,
          meta: {
            reversedPayments: payments.length,
            totalAmount: total.toNumber(),
            debtIds,
            businessId,
          },
        },
        tx,
      );

      for (const debtId of debtIds) {
        await this.recalculateDebtBalance(tx, debtId, userId, groupId);
      }

      return {
        message: 'Pago global reversado correctamente',
        reversedCount: payments.length,
      };
    });
  }

  async findAll(businessId: string, query: QueryPaymentDto) {
    return this.list({ businessId }, query);
  }

  async findByDebt(debtId: string, businessId: string, query: QueryPaymentDto) {
    const debt = await this.prisma.debt.findFirst({
      where: { id: debtId, businessId },
      select: { id: true },
    });
    if (!debt) throw new NotFoundException('Deuda no encontrada');

    return this.list({ businessId, debtId }, query);
  }

  private list(scope: Prisma.PaymentWhereInput, query: QueryPaymentDto) {
    const {
      page = 1,
      limit = 10,
      type,
      method,
      search,
      sortBy,
      order = 'desc',
    } = query;

    const and: Prisma.PaymentWhereInput[] = [scope];
    if (type) and.push({ type });
    if (method) and.push({ method });
    const term = search?.trim();
    if (term) {
      and.push({ note: { contains: term, mode: 'insensitive' } });
    }

    return paginate(
      this.prisma.payment,
      {
        where: { AND: and },
        orderBy: [{ [sortBy ?? 'createdAt']: order }, { id: order }],
        select: paymentSelect,
      },
      { page, limit },
    );
  }

  /**
   * Bloquea la deuda (`FOR UPDATE`) y valida que sea del negocio y que todavía
   * se pueda mover. Abonos, descuentos y anulaciones toman este mismo bloqueo,
   * así que sobre una misma deuda se aplican de a uno.
   */
  private async lockOpenDebt(tx: Tx, debtId: string, businessId: string) {
    await this.lockDebts(tx, [debtId]);

    const debt = await tx.debt.findFirst({
      where: { id: debtId, businessId },
      select: { id: true, debtorId: true, status: true, balance: true },
    });
    if (!debt) throw new NotFoundException('Deuda no encontrada');

    if (debt.status === DebtStatus.CANCELLED) {
      throw new BadRequestException('La deuda está anulada');
    }
    if (debt.status === DebtStatus.PAID || debt.balance.lte(0)) {
      throw new BadRequestException('La deuda ya está saldada');
    }
    return debt;
  }

  private async lockDebts(tx: Tx, debtIds: string[]) {
    const ids = [...debtIds].sort();
    await tx.$queryRaw`
      SELECT id FROM "Debt" WHERE id IN (${Prisma.join(ids)})
      ORDER BY id FOR UPDATE`;
  }

  /**
   * Recalcula saldo y estado desde todos los movimientos de la deuda. Se
   * llama dentro de la transacción del movimiento y con la deuda ya
   * bloqueada; la auditoría va en la misma transacción.
   */
  private async recalculateDebtBalance(
    tx: Tx,
    debtId: string,
    userId: string,
    causeId: string,
  ) {
    const debt = await tx.debt.findUnique({
      where: { id: debtId },
      select: {
        amount: true,
        balance: true,
        status: true,
        payments: { select: { amount: true, type: true } },
      },
    });
    if (!debt) throw new NotFoundException('Deuda no encontrada');

    if (debt.status === DebtStatus.CANCELLED) {
      throw new BadRequestException('La deuda está anulada');
    }

    // Se opera con Decimal y no con `number`: la coma flotante acumula
    // errores de redondeo (0.1 + 0.2 !== 0.3).
    const computed = debt.payments.reduce(
      (acc, p) => (SIGN[p.type] < 0 ? acc.minus(p.amount) : acc.plus(p.amount)),
      debt.amount,
    );
    const balance = Prisma.Decimal.max(computed.toDecimalPlaces(2), 0);

    const status: DebtStatus = balance.isZero()
      ? DebtStatus.PAID
      : balance.gte(debt.amount)
        ? DebtStatus.OPEN
        : DebtStatus.PARTIAL;

    await tx.debt.update({
      where: { id: debtId },
      data: { balance, status },
    });

    await this.auditService.log(
      {
        userId,
        action: AuditAction.DEBT_STATUS_CHANGED,
        entity: 'Debt',
        entityId: debtId,
        meta: {
          previousBalance: debt.balance.toNumber(),
          newBalance: balance.toNumber(),
          previousStatus: debt.status,
          status,
          causeId,
        },
      },
      tx,
    );

    return { balance: balance.toNumber(), status };
  }
}
