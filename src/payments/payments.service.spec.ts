import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DebtStatus, PaymentType, Prisma } from '@prisma/client';
import { AuditService } from 'src/audit/audit.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaymentsService } from './payments.service';

/**
 * Reglas del service sin base de datos. Lo que depende de Postgres (los
 * bloqueos, los decimales, el índice único de los reversos y las peticiones
 * simultáneas) se prueba contra la base real en test/payments.db-spec.ts.
 */

const D = (value: number | string) => new Prisma.Decimal(value);

type Movement = { amount: Prisma.Decimal; type: PaymentType };

function setup() {
  const calls: string[] = [];
  const track =
    <T>(name: string, impl: (...args: any[]) => T) =>
    (...args: any[]) => {
      calls.push(name);
      return impl(...args);
    };

  const queryRaw = jest.fn(track('lock', () => Promise.resolve([])));
  const debtUpdate = jest.fn(track('debt.update', () => Promise.resolve({})));
  const debtFindUnique = jest.fn();
  const debtFindFirst = jest.fn();
  const debtFindMany = jest.fn(
    track('debt.findMany', () => Promise.resolve([])),
  );
  const paymentCreate = jest.fn(
    track('payment.create', () => Promise.resolve({ id: 'new-payment' })),
  );
  const paymentFindFirst = jest.fn();
  const paymentFindMany = jest.fn(
    track('payment.findMany', () => Promise.resolve([])),
  );
  const paymentCount = jest.fn(() => Promise.resolve(0));
  const groupCreate = jest.fn(() => Promise.resolve({ id: 'group-1' }));
  const groupUpdateMany = jest.fn(
    track('group.claim', () => Promise.resolve({ count: 1 })),
  );
  const groupFindFirst = jest.fn();
  const debtorFindFirst = jest.fn(() =>
    Promise.resolve({ id: 'debtor-1', name: 'Cliente' }),
  );
  const auditLog = jest.fn(() => Promise.resolve());

  const tx = {
    $queryRaw: queryRaw,
    debt: {
      update: debtUpdate,
      findUnique: debtFindUnique,
      findFirst: debtFindFirst,
      findMany: debtFindMany,
    },
    payment: {
      create: paymentCreate,
      findFirst: paymentFindFirst,
      findMany: paymentFindMany,
      count: paymentCount,
    },
    paymentGroup: {
      create: groupCreate,
      updateMany: groupUpdateMany,
      findFirst: groupFindFirst,
    },
    debtor: { findFirst: debtorFindFirst },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  /** La deuda que ve el recálculo: monto, estado y sus movimientos. */
  const debtForRecalc = (
    amount: number,
    movements: Movement[],
    status: DebtStatus = DebtStatus.OPEN,
  ) =>
    debtFindUnique.mockResolvedValue({
      amount: D(amount),
      balance: D(amount),
      status,
      payments: movements,
    });

  /** Lo que quedó guardado en la deuda en el último recálculo. */
  const savedDebt = () => {
    const [args] = debtUpdate.mock.calls.at(-1) as unknown as [
      { data: { balance: Prisma.Decimal; status: DebtStatus } },
    ];
    return {
      balance: args.data.balance.toFixed(2),
      status: args.data.status,
    };
  };

  /** Ids bloqueados en cada `FOR UPDATE`, en el orden en que se enviaron. */
  const lockedIds = () =>
    queryRaw.mock.calls.map(
      (args) => (args as unknown as [unknown, Prisma.Sql])[1]?.values,
    );

  return {
    calls,
    tx,
    prisma,
    auditLog,
    debtFindFirst,
    debtFindMany,
    paymentCreate,
    paymentFindFirst,
    paymentFindMany,
    paymentCount,
    groupCreate,
    groupUpdateMany,
    groupFindFirst,
    debtForRecalc,
    savedDebt,
    lockedIds,
  };
}

async function build(mocks: ReturnType<typeof setup>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PaymentsService,
      { provide: PrismaService, useValue: mocks.prisma },
      { provide: AuditService, useValue: { log: mocks.auditLog } },
    ],
  }).compile();
  return moduleRef.get(PaymentsService);
}

const payment = (amount: number): Movement => ({
  amount: D(amount),
  type: PaymentType.PAYMENT,
});
const discount = (amount: number): Movement => ({
  amount: D(amount),
  type: PaymentType.DISCOUNT,
});
const reversal = (amount: number): Movement => ({
  amount: D(amount),
  type: PaymentType.REVERSAL,
});

describe('PaymentsService', () => {
  describe('recálculo del saldo y del estado', () => {
    /** Registra un abono para disparar el recálculo con esos movimientos. */
    async function recalcWith(
      amount: number,
      movements: Movement[],
      status: DebtStatus = DebtStatus.OPEN,
    ) {
      const mocks = setup();
      mocks.debtFindFirst.mockResolvedValue({
        id: 'debt-1',
        debtorId: 'debtor-1',
        status: DebtStatus.OPEN,
        balance: D(amount),
      });
      mocks.debtForRecalc(amount, movements, status);
      const service = await build(mocks);
      await service.create(
        { debtId: 'debt-1', amount: 1, method: 'CASH' },
        'user-1',
        'business-1',
      );
      return mocks.savedDebt();
    }

    it('abonos y descuentos bajan el saldo: queda PARTIAL', async () => {
      expect(await recalcWith(100, [payment(30), discount(20)])).toEqual({
        balance: '50.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('en cero queda PAID', async () => {
      expect(await recalcWith(100, [payment(60), discount(40)])).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
    });

    it('un reverso devuelve lo que había bajado: sin otros movimientos vuelve a OPEN', async () => {
      expect(await recalcWith(100, [payment(100), reversal(100)])).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
    });

    it('el saldo nunca queda negativo', async () => {
      expect(await recalcWith(100, [payment(80), payment(80)])).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
    });

    it('no recalcula una deuda anulada', async () => {
      await expect(
        recalcWith(100, [payment(10)], DebtStatus.CANCELLED),
      ).rejects.toThrow('La deuda está anulada');
    });
  });

  describe('create (abono)', () => {
    it('bloquea la deuda antes de leer el saldo', async () => {
      const mocks = setup();
      mocks.debtFindFirst.mockImplementation(() => {
        mocks.calls.push('debt.findFirst');
        return Promise.resolve({
          id: 'debt-1',
          debtorId: 'debtor-1',
          status: DebtStatus.OPEN,
          balance: D(100),
        });
      });
      mocks.debtForRecalc(100, [payment(10)]);
      const service = await build(mocks);

      await service.create(
        { debtId: 'debt-1', amount: 10, method: 'CASH' },
        'user-1',
        'business-1',
      );

      expect(mocks.calls.slice(0, 2)).toEqual(['lock', 'debt.findFirst']);
    });

    it.each([
      ['pagada', DebtStatus.PAID, 0, 'La deuda ya está saldada'],
      ['anulada', DebtStatus.CANCELLED, 50, 'La deuda está anulada'],
    ])('no abona a una deuda %s', async (_, status, balance, message) => {
      const mocks = setup();
      mocks.debtFindFirst.mockResolvedValue({
        id: 'debt-1',
        debtorId: 'debtor-1',
        status,
        balance: D(balance),
      });
      const service = await build(mocks);

      await expect(
        service.create(
          { debtId: 'debt-1', amount: 10, method: 'CASH' },
          'user-1',
          'business-1',
        ),
      ).rejects.toThrow(message);
      expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('responde 404 si la deuda no es del negocio', async () => {
      const mocks = setup();
      mocks.debtFindFirst.mockResolvedValue(null);
      const service = await build(mocks);

      await expect(
        service.create(
          { debtId: 'debt-1', amount: 10, method: 'CASH' },
          'user-1',
          'business-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createGlobalPayment (pago global)', () => {
    it('bloquea las deudas del cliente antes de leerlas', async () => {
      const mocks = setup();
      const service = await build(mocks);

      await expect(
        service.createGlobalPayment(
          { debtorId: 'debtor-1', amount: 10, method: 'CASH' },
          'user-1',
          'business-1',
        ),
      ).rejects.toThrow('El deudor no tiene deudas pendientes');

      expect(mocks.calls).toEqual(['lock', 'debt.findMany']);
    });

    it('reparte en el orden recibido y no crea más movimientos que los necesarios', async () => {
      const mocks = setup();
      mocks.debtFindMany.mockResolvedValue([
        { id: 'old', balance: D(30) },
        { id: 'mid', balance: D(50) },
        { id: 'new', balance: D(100) },
      ]);
      mocks.debtForRecalc(100, []);
      const service = await build(mocks);

      await service.createGlobalPayment(
        { debtorId: 'debtor-1', amount: 60, method: 'CASH' },
        'user-1',
        'business-1',
      );

      const created = mocks.paymentCreate.mock.calls.map((args) => {
        const [{ data }] = args as unknown as [
          { data: { debtId: string; amount: Prisma.Decimal } },
        ];
        return [data.debtId, data.amount.toFixed(2)];
      });
      expect(created).toEqual([
        ['old', '30.00'],
        ['mid', '30.00'],
      ]);
    });

    it('no crea el grupo si el monto pasa del saldo total', async () => {
      const mocks = setup();
      mocks.debtFindMany.mockResolvedValue([
        { id: 'a', balance: D(30) },
        { id: 'b', balance: D(20) },
      ]);
      const service = await build(mocks);

      await expect(
        service.createGlobalPayment(
          { debtorId: 'debtor-1', amount: 50.01, method: 'CASH' },
          'user-1',
          'business-1',
        ),
      ).rejects.toThrow('El monto excede la deuda total (50)');
      expect(mocks.groupCreate).not.toHaveBeenCalled();
    });
  });

  describe('reversePayment', () => {
    const target = (overrides: Record<string, unknown> = {}) => ({
      id: 'payment-1',
      debtId: 'debt-1',
      amount: D(40),
      method: 'CASH',
      type: PaymentType.PAYMENT,
      paymentGroupId: null,
      reversal: null,
      ...overrides,
    });

    it('un abono de un pago global no se reversa solo y no bloquea nada', async () => {
      const mocks = setup();
      mocks.paymentFindFirst.mockResolvedValue(
        target({ paymentGroupId: 'group-1' }),
      );
      const service = await build(mocks);

      const error = await service
        .reversePayment('payment-1', {}, 'user-1', 'business-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        error: 'PAYMENT_IN_GROUP',
        paymentGroupId: 'group-1',
      });
      expect(mocks.calls).not.toContain('lock');
    });

    it('vuelve a mirar si ya se reversó después de bloquear la deuda', async () => {
      const mocks = setup();
      mocks.paymentFindFirst.mockResolvedValue(target());
      mocks.paymentCount.mockImplementation(() => {
        mocks.calls.push('payment.count');
        return Promise.resolve(1);
      });
      const service = await build(mocks);

      await expect(
        service.reversePayment('payment-1', {}, 'user-1', 'business-1'),
      ).rejects.toThrow('Este movimiento ya fue reversado');
      expect(mocks.calls).toEqual(['lock', 'payment.count']);
      expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('el reverso lleva el mismo monto y método, y el motivo en la nota', async () => {
      const mocks = setup();
      mocks.paymentFindFirst.mockResolvedValue(
        target({ type: PaymentType.DISCOUNT, method: 'OTHER' }),
      );
      mocks.debtForRecalc(100, []);
      const service = await build(mocks);

      await service.reversePayment(
        'payment-1',
        { reason: 'Se equivocó' },
        'user-1',
        'business-1',
      );

      const [[{ data }]] = mocks.paymentCreate.mock.calls as unknown as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data).toMatchObject({
        type: PaymentType.REVERSAL,
        amount: D(40),
        method: 'OTHER',
        reversedPaymentId: 'payment-1',
        note: 'Reverso de descuento: Se equivocó',
      });
    });
  });

  describe('reversePaymentGroup', () => {
    it('reclama el grupo antes de leer y bloquea las deudas en orden de id', async () => {
      const mocks = setup();
      mocks.paymentFindMany.mockImplementation(() => {
        mocks.calls.push('payment.findMany');
        return Promise.resolve([
          { id: 'p1', debtId: 'debt-c', amount: D(10), method: 'CASH' },
          { id: 'p2', debtId: 'debt-a', amount: D(10), method: 'CASH' },
          { id: 'p3', debtId: 'debt-b', amount: D(10), method: 'CASH' },
        ]);
      });
      mocks.debtForRecalc(100, []);
      const service = await build(mocks);

      await service.reversePaymentGroup('group-1', 'user-1', 'business-1');

      expect(mocks.calls.slice(0, 3)).toEqual([
        'group.claim',
        'payment.findMany',
        'lock',
      ]);
      expect(mocks.lockedIds()).toEqual([['debt-a', 'debt-b', 'debt-c']]);
    });

    it('si no lo pudo reclamar, distingue 404 de ya reversado', async () => {
      const mocks = setup();
      mocks.groupUpdateMany.mockResolvedValue({ count: 0 });
      mocks.groupFindFirst.mockResolvedValueOnce(null);
      mocks.groupFindFirst.mockResolvedValueOnce({ id: 'group-1' });
      const service = await build(mocks);

      await expect(
        service.reversePaymentGroup('group-1', 'user-1', 'business-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.reversePaymentGroup('group-1', 'user-1', 'business-1'),
      ).rejects.toThrow('Este pago global ya fue reversado');
      expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });
  });
});
