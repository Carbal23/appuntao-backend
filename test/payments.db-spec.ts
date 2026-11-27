import {
  BusinessUserRole,
  DebtStatus,
  PaymentType,
  Prisma,
} from '@prisma/client';
import { Response } from 'supertest';
import {
  addMember,
  createBusiness,
  createDebt,
  createDebtor,
  createUser,
  debtState,
} from './db/factories';
import { asMember, createTestApp, resetDatabase, TestApp } from './db/test-app';

/**
 * Payments por HTTP contra la base de pruebas (`appuntao_test`): guards,
 * validación, transacciones, bloqueos `FOR UPDATE`, decimales de Postgres e
 * índice único de los reversos. Ver docs/pruebas.md.
 */

type Body = Record<string, any>;
const body = (res: Response) => res.body as Body;

describe('Payments (base real)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  /**
   * Un negocio con dueño, cajero y consultor, un cliente y otro negocio
   * ajeno con su propia deuda.
   */
  async function scenario() {
    await resetDatabase(t.prisma);
    const owner = await createUser(t.prisma, 'Dueño');
    const cashier = await createUser(t.prisma, 'Cajero');
    const viewer = await createUser(t.prisma, 'Consultor');
    const business = await createBusiness(t.prisma, owner.id);
    await addMember(
      t.prisma,
      business.id,
      cashier.id,
      BusinessUserRole.CASHIER,
    );
    await addMember(t.prisma, business.id, viewer.id, BusinessUserRole.VIEWER);
    const debtor = await createDebtor(t.prisma, business.id);

    const otherOwner = await createUser(t.prisma, 'Otro dueño');
    const otherBusiness = await createBusiness(t.prisma, otherOwner.id, 'Otra');
    const otherDebtor = await createDebtor(t.prisma, otherBusiness.id);
    const otherDebt = await createDebt(t.prisma, {
      businessId: otherBusiness.id,
      debtorId: otherDebtor.id,
      createdBy: otherOwner.id,
      amount: 100,
    });

    const as = async (user: { id: string }) =>
      asMember(t.app, await t.tokenFor(user), business.id);

    const debt = (amount: number | string, createdAt?: Date) =>
      createDebt(t.prisma, {
        businessId: business.id,
        debtorId: debtor.id,
        createdBy: owner.id,
        amount,
        createdAt,
      });

    return {
      business,
      debtor,
      otherDebtor,
      otherDebt,
      debt,
      owner: await as(owner),
      cashier: await as(cashier),
      viewer: await as(viewer),
    };
  }

  const movements = (debtId: string) =>
    t.prisma.payment.findMany({
      where: { debtId },
      orderBy: { createdAt: 'asc' },
    });

  describe('POST /api/payments (abono)', () => {
    it('baja el saldo y deja la deuda en PARTIAL', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const res = await s.cashier
        .post('/api/payments', { debtId: debt.id, amount: 30, method: 'CASH' })
        .expect(201);

      expect(body(res)).toMatchObject({ type: 'PAYMENT', method: 'CASH' });
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '70.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('deja auditoría del abono y del cambio de saldo en la misma operación', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const res = await s.owner
        .post('/api/payments', {
          debtId: debt.id,
          amount: 100,
          method: 'TRANSFER',
        })
        .expect(201);

      const actions = await t.prisma.auditLog.findMany({
        where: { entityId: { in: [body(res).id as string, debt.id] } },
        select: { action: true },
      });
      expect(actions.map((a) => a.action).sort()).toEqual([
        'DEBT_STATUS_CHANGED',
        'PAYMENT_CREATED',
      ]);
    });

    it('con el saldo completo la deja en PAID, y ya no admite otro abono', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 100, method: 'CASH' })
        .expect(201);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });

      const res = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 1, method: 'CASH' })
        .expect(400);
      expect(body(res).message).toBe('La deuda ya está saldada');
    });

    it('no admite más que el saldo y no deja nada creado', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const res = await s.owner
        .post('/api/payments', {
          debtId: debt.id,
          amount: 100.01,
          method: 'CASH',
        })
        .expect(400);

      expect(body(res).message).toBe(
        'El abono no puede ser mayor al saldo de la deuda (100)',
      );
      expect(await movements(debt.id)).toHaveLength(0);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
    });

    it('suma centavos sin errores de redondeo (0,10 + 0,20 salda 0,30)', async () => {
      const s = await scenario();
      const debt = await s.debt('0.30');

      await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 0.1, method: 'CASH' })
        .expect(201);
      await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 0.2, method: 'CASH' })
        .expect(201);

      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
    });

    it.each([
      ['monto cero', { amount: 0 }],
      ['monto negativo', { amount: -5 }],
      ['más de dos decimales', { amount: 10.123 }],
      ['un descuento por esta ruta', { amount: 10, type: 'DISCOUNT' }],
      ['un campo de más', { amount: 10, businessId: 'x' }],
      ['un método que no existe', { amount: 10, method: 'BITCOIN' }],
    ])('rechaza %s (400) sin tocar la deuda', async (_, extra) => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.owner
        .post('/api/payments', { debtId: debt.id, method: 'CASH', ...extra })
        .expect(400);

      expect(await movements(debt.id)).toHaveLength(0);
    });

    it('no encuentra la deuda de otro negocio (404)', async () => {
      const s = await scenario();

      await s.owner
        .post('/api/payments', {
          debtId: s.otherDebt.id,
          amount: 10,
          method: 'CASH',
        })
        .expect(404);

      expect(await debtState(t.prisma, s.otherDebt.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
    });

    it('no abona a una deuda anulada', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      await t.prisma.debt.update({
        where: { id: debt.id },
        data: { status: DebtStatus.CANCELLED },
      });

      const res = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 10, method: 'CASH' })
        .expect(400);
      expect(body(res).message).toBe('La deuda está anulada');
    });

    it('el consultor no puede abonar (403)', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.viewer
        .post('/api/payments', { debtId: debt.id, amount: 10, method: 'CASH' })
        .expect(403);
    });

    it('dos abonos a la vez que juntos pasan del saldo: entra uno solo', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      const pay = () =>
        s.owner.post('/api/payments', {
          debtId: debt.id,
          amount: 60,
          method: 'CASH',
        });

      const results = await Promise.all([pay(), pay(), pay()]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
      expect(await movements(debt.id)).toHaveLength(1);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '40.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('muchos abonos a la vez sobre la misma deuda: el saldo cuadra con todos', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          s.cashier.post('/api/payments', {
            debtId: debt.id,
            amount: 10,
            method: 'CASH',
          }),
        ),
      );

      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '20.00',
        status: DebtStatus.PARTIAL,
      });
    });
  });

  describe('POST /api/payments/discounts (descuento)', () => {
    it('el dueño descuenta con motivo y baja el saldo', async () => {
      const s = await scenario();
      const debt = await s.debt(1000);

      const res = await s.owner
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 300,
          reason: '  Se le perdonan las vueltas  ',
        })
        .expect(201);

      expect(body(res)).toMatchObject({
        type: 'DISCOUNT',
        method: 'OTHER',
        note: 'Se le perdonan las vueltas',
      });
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '700.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('descontar todo el saldo la deja en PAID', async () => {
      const s = await scenario();
      const debt = await s.debt(300);

      await s.owner
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 300,
          reason: 'Cliente de siempre',
        })
        .expect(201);

      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
    });

    it('el cajero no puede descontar (403)', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.cashier
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 10,
          reason: 'Por buen cliente',
        })
        .expect(403);
      expect(await movements(debt.id)).toHaveLength(0);
    });

    it('exige el motivo (400)', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.owner
        .post('/api/payments/discounts', { debtId: debt.id, amount: 10 })
        .expect(400);
      await s.owner
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 10,
          reason: '  a ',
        })
        .expect(400);
    });

    it('no descuenta más que el saldo', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const res = await s.owner
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 150,
          reason: 'Por buen cliente',
        })
        .expect(400);
      expect(body(res).message).toBe(
        'El descuento no puede ser mayor al saldo de la deuda (100)',
      );
    });
  });

  describe('POST /api/payments/global (pago global)', () => {
    const days = (n: number) => new Date(Date.UTC(2026, 0, n));

    it('reparte de la deuda más antigua a la más nueva', async () => {
      const s = await scenario();
      // Se crean en desorden: manda la fecha, no el orden de creación.
      const newest = await s.debt(100, days(20));
      const oldest = await s.debt(50, days(1));
      const middle = await s.debt(80, days(10));

      const res = await s.cashier
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 150,
          method: 'TRANSFER',
          note: 'Quincena',
        })
        .expect(201);

      expect(await debtState(t.prisma, oldest.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
      expect(await debtState(t.prisma, middle.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
      expect(await debtState(t.prisma, newest.id)).toEqual({
        balance: '80.00',
        status: DebtStatus.PARTIAL,
      });

      const result = body(res);
      expect(result.summary).toEqual({ totalApplied: 150, debtsAffected: 3 });
      expect(
        (result.payments as Body[]).map((p) => [
          p.debtId as string,
          p.appliedAmount as number,
        ]),
      ).toEqual([
        [oldest.id, 50],
        [middle.id, 80],
        [newest.id, 20],
      ]);

      const group = await t.prisma.paymentGroup.findUniqueOrThrow({
        where: { id: (result.group as Body).id as string },
        include: { payments: true },
      });
      expect(group.totalAmount.toFixed(2)).toBe('150.00');
      expect(group.payments).toHaveLength(3);
    });

    it('no toca deudas que no le alcanzan', async () => {
      const s = await scenario();
      const first = await s.debt(100, days(1));
      const second = await s.debt(100, days(2));

      await s.owner
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 40,
          method: 'CASH',
        })
        .expect(201);

      expect(await debtState(t.prisma, first.id)).toEqual({
        balance: '60.00',
        status: DebtStatus.PARTIAL,
      });
      expect(await movements(second.id)).toHaveLength(0);
    });

    it('salta las deudas pagadas y anuladas', async () => {
      const s = await scenario();
      const cancelled = await s.debt(100, days(1));
      await t.prisma.debt.update({
        where: { id: cancelled.id },
        data: { status: DebtStatus.CANCELLED },
      });
      const open = await s.debt(100, days(2));

      await s.owner
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 100,
          method: 'CASH',
        })
        .expect(201);

      expect(await movements(cancelled.id)).toHaveLength(0);
      expect(await debtState(t.prisma, open.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
    });

    it('no admite más que el saldo total y no deja nada creado', async () => {
      const s = await scenario();
      await s.debt(100, days(1));
      await s.debt(50, days(2));

      const res = await s.owner
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 150.5,
          method: 'CASH',
        })
        .expect(400);

      expect(body(res).message).toBe('El monto excede la deuda total (150)');
      expect(await t.prisma.payment.count()).toBe(0);
      expect(await t.prisma.paymentGroup.count()).toBe(0);
    });

    it('sin deudas pendientes responde 400', async () => {
      const s = await scenario();

      const res = await s.owner
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 10,
          method: 'CASH',
        })
        .expect(400);
      expect(body(res).message).toBe('El deudor no tiene deudas pendientes');
    });

    it('no encuentra al cliente de otro negocio (404)', async () => {
      const s = await scenario();

      await s.owner
        .post('/api/payments/global', {
          debtorId: s.otherDebtor.id,
          amount: 10,
          method: 'CASH',
        })
        .expect(404);
      expect(await movements(s.otherDebt.id)).toHaveLength(0);
    });

    it('dos pagos globales a la vez que juntos pasan del saldo: entra uno solo', async () => {
      const s = await scenario();
      const a = await s.debt(100, days(1));
      const b = await s.debt(100, days(2));
      const pay = () =>
        s.owner.post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 150,
          method: 'CASH',
        });

      const results = await Promise.all([pay(), pay()]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await t.prisma.paymentGroup.count()).toBe(1);
      expect(await debtState(t.prisma, a.id)).toEqual({
        balance: '0.00',
        status: DebtStatus.PAID,
      });
      expect(await debtState(t.prisma, b.id)).toEqual({
        balance: '50.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('un pago global y un abono suelto a la vez: el saldo nunca queda negativo', async () => {
      const s = await scenario();
      const debt = await s.debt(100, days(1));

      const results = await Promise.all([
        s.owner.post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 80,
          method: 'CASH',
        }),
        s.cashier.post('/api/payments', {
          debtId: debt.id,
          amount: 80,
          method: 'CASH',
        }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '20.00',
        status: DebtStatus.PARTIAL,
      });
    });
  });

  describe('POST /api/payments/:id/reverse (reverso)', () => {
    async function paidDebt(s: Awaited<ReturnType<typeof scenario>>) {
      const debt = await s.debt(100);
      const res = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 100, method: 'CASH' })
        .expect(201);
      return { debt, paymentId: body(res).id as string };
    }

    it('devuelve el saldo, reabre la deuda y queda enlazado al original', async () => {
      const s = await scenario();
      const { debt, paymentId } = await paidDebt(s);

      const res = await s.owner
        .post(`/api/payments/${paymentId}/reverse`, {
          reason: 'Se registró de más',
        })
        .expect(201);

      expect(body(res)).toMatchObject({
        type: PaymentType.REVERSAL,
        reversedPaymentId: paymentId,
        note: 'Reverso de abono: Se registró de más',
      });
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });

      // Reabierta, se puede volver a abonar.
      await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 25, method: 'CASH' })
        .expect(201);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '75.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('reversar un abono parcial deja la deuda como estaba', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 30, method: 'CASH' })
        .expect(201);
      const second = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 20, method: 'CASH' })
        .expect(201);

      await s.owner
        .post(`/api/payments/${body(second).id as string}/reverse`)
        .expect(201);

      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '70.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('reversa un descuento', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      const discount = await s.owner
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 100,
          reason: 'Cliente de siempre',
        })
        .expect(201);

      const res = await s.owner
        .post(`/api/payments/${body(discount).id as string}/reverse`)
        .expect(201);

      expect(body(res).note).toBe('Reverso de descuento');
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
    });

    it('cada movimiento se reversa una sola vez', async () => {
      const s = await scenario();
      const { debt, paymentId } = await paidDebt(s);

      await s.owner.post(`/api/payments/${paymentId}/reverse`).expect(201);
      const res = await s.owner
        .post(`/api/payments/${paymentId}/reverse`)
        .expect(400);

      expect(body(res).message).toBe('Este movimiento ya fue reversado');
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
    });

    it('dos reversos a la vez del mismo abono: queda uno solo', async () => {
      const s = await scenario();
      const { debt, paymentId } = await paidDebt(s);
      const reverse = () => s.owner.post(`/api/payments/${paymentId}/reverse`);

      const results = await Promise.all([reverse(), reverse(), reverse()]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
      expect(
        await t.prisma.payment.count({
          where: { reversedPaymentId: paymentId },
        }),
      ).toBe(1);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
    });

    it('un reverso no se puede reversar', async () => {
      const s = await scenario();
      const { paymentId } = await paidDebt(s);
      const reversal = await s.owner
        .post(`/api/payments/${paymentId}/reverse`)
        .expect(201);

      const res = await s.owner
        .post(`/api/payments/${body(reversal).id as string}/reverse`)
        .expect(400);
      expect(body(res).message).toBe('Un reverso no se puede reversar');
    });

    it('un abono de un pago global se reversa con el grupo (PAYMENT_IN_GROUP)', async () => {
      const s = await scenario();
      await s.debt(100);
      const global = await s.owner
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 50,
          method: 'CASH',
        })
        .expect(201);
      const result = body(global);
      const paymentId = (result.payments as Body[])[0].paymentId as string;

      const res = await s.owner
        .post(`/api/payments/${paymentId}/reverse`)
        .expect(400);

      expect(body(res)).toMatchObject({
        error: 'PAYMENT_IN_GROUP',
        paymentGroupId: (result.group as Body).id as string,
      });
    });

    it('el cajero no puede reversar (403)', async () => {
      const s = await scenario();
      const { paymentId } = await paidDebt(s);

      await s.cashier.post(`/api/payments/${paymentId}/reverse`).expect(403);
    });

    it('no encuentra el abono de otro negocio (404)', async () => {
      const s = await scenario();
      const foreign = await t.prisma.payment.create({
        data: {
          debtId: s.otherDebt.id,
          businessId: s.otherDebt.businessId,
          amount: 10,
          createdBy: s.otherDebt.createdBy,
        },
      });

      await s.owner.post(`/api/payments/${foreign.id}/reverse`).expect(404);
    });
  });

  describe('POST /api/payments/global/reverse/:groupId (reverso del pago global)', () => {
    async function globalPayment(s: Awaited<ReturnType<typeof scenario>>) {
      const a = await s.debt(100, new Date(Date.UTC(2026, 0, 1)));
      const b = await s.debt(100, new Date(Date.UTC(2026, 0, 2)));
      const res = await s.owner
        .post('/api/payments/global', {
          debtorId: s.debtor.id,
          amount: 150,
          method: 'CASH',
        })
        .expect(201);
      return { a, b, groupId: (body(res).group as Body).id as string };
    }

    it('devuelve el saldo de todas las deudas del grupo', async () => {
      const s = await scenario();
      const { a, b, groupId } = await globalPayment(s);

      const res = await s.owner
        .post(`/api/payments/global/reverse/${groupId}`)
        .expect(201);

      expect(body(res)).toEqual({
        message: 'Pago global reversado correctamente',
        reversedCount: 2,
      });
      expect(await debtState(t.prisma, a.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
      expect(await debtState(t.prisma, b.id)).toEqual({
        balance: '100.00',
        status: DebtStatus.OPEN,
      });
      const group = await t.prisma.paymentGroup.findUniqueOrThrow({
        where: { id: groupId },
      });
      expect(group.reversedAt).not.toBeNull();
    });

    it('un grupo se reversa una sola vez', async () => {
      const s = await scenario();
      const { groupId } = await globalPayment(s);

      await s.owner.post(`/api/payments/global/reverse/${groupId}`).expect(201);
      const res = await s.owner
        .post(`/api/payments/global/reverse/${groupId}`)
        .expect(400);
      expect(body(res).message).toBe('Este pago global ya fue reversado');
    });

    it('dos reversos a la vez del mismo grupo: se reversa una vez', async () => {
      const s = await scenario();
      const { a, b, groupId } = await globalPayment(s);
      const reverse = () =>
        s.owner.post(`/api/payments/global/reverse/${groupId}`);

      const results = await Promise.all([reverse(), reverse()]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(
        await t.prisma.payment.count({ where: { type: PaymentType.REVERSAL } }),
      ).toBe(2);
      expect((await debtState(t.prisma, a.id)).balance).toBe('100.00');
      expect((await debtState(t.prisma, b.id)).balance).toBe('100.00');
    });

    it('el cajero no puede reversarlo (403) y otro negocio no lo encuentra (404)', async () => {
      const s = await scenario();
      const { groupId } = await globalPayment(s);

      await s.cashier
        .post(`/api/payments/global/reverse/${groupId}`)
        .expect(403);

      const outsider = await createUser(t.prisma, 'Ajeno');
      const otherBusiness = await createBusiness(
        t.prisma,
        outsider.id,
        'Ajena',
      );
      const asOutsider = asMember(
        t.app,
        await t.tokenFor(outsider),
        otherBusiness.id,
      );
      await asOutsider
        .post(`/api/payments/global/reverse/${groupId}`)
        .expect(404);
    });
  });

  /**
   * Las carreras de arriba prueban el resultado, pero pasan también sin
   * bloqueo cuando las peticiones no llegan a cruzarse. Estas no dependen de
   * la suerte: otra transacción tiene la deuda bloqueada y la cambia; la
   * petición tiene que esperar y ver el cambio. Sin `FOR UPDATE` leería el
   * saldo viejo.
   */
  describe('bloqueo de la deuda (FOR UPDATE)', () => {
    const HOLD_MS = 500;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Bloquea las deudas en otra transacción mientras corre `during`. */
    const whileLocked = (
      debtIds: string[],
      during: (tx: Prisma.TransactionClient) => Promise<void>,
    ) =>
      t.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "Debt" WHERE id IN (${Prisma.join(debtIds)}) FOR UPDATE`;
          await during(tx);
        },
        { timeout: 15_000 },
      );

    /** Otro movimiento que deja la deuda en `balance`, aún sin confirmar. */
    const lowerBalance = (
      tx: Prisma.TransactionClient,
      debt: { id: string; businessId: string; createdBy: string },
      amount: number,
      balance: number,
    ) =>
      Promise.all([
        tx.payment.create({
          data: {
            debtId: debt.id,
            businessId: debt.businessId,
            amount,
            createdBy: debt.createdBy,
          },
        }),
        tx.debt.update({
          where: { id: debt.id },
          data: { balance, status: DebtStatus.PARTIAL },
        }),
      ]);

    it('el abono espera y lee el saldo que dejó el otro movimiento', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      let pending!: Promise<Response>;

      await whileLocked([debt.id], async (tx) => {
        await lowerBalance(tx, debt, 50, 50);
        pending = s.owner
          .post('/api/payments', {
            debtId: debt.id,
            amount: 60,
            method: 'CASH',
          })
          .then((res) => res);
        await sleep(HOLD_MS);
      });

      const res = await pending;
      expect(res.status).toBe(400);
      expect(body(res).message).toBe(
        'El abono no puede ser mayor al saldo de la deuda (50)',
      );
    });

    it('el pago global espera y lee el saldo que dejó el otro movimiento', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      let pending!: Promise<Response>;

      await whileLocked([debt.id], async (tx) => {
        await lowerBalance(tx, debt, 50, 50);
        pending = s.owner
          .post('/api/payments/global', {
            debtorId: s.debtor.id,
            amount: 60,
            method: 'CASH',
          })
          .then((res) => res);
        await sleep(HOLD_MS);
      });

      const res = await pending;
      expect(res.status).toBe(400);
      expect(body(res).message).toBe('El monto excede la deuda total (50)');
      expect(await t.prisma.paymentGroup.count()).toBe(0);
    });

    it('el reverso espera y ve el reverso que hizo la otra transacción', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      const payment = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 100, method: 'CASH' })
        .expect(201);
      const paymentId = body(payment).id as string;
      let pending!: Promise<Response>;

      await whileLocked([debt.id], async (tx) => {
        await tx.payment.create({
          data: {
            debtId: debt.id,
            businessId: debt.businessId,
            amount: 100,
            type: PaymentType.REVERSAL,
            createdBy: debt.createdBy,
            reversedPaymentId: paymentId,
          },
        });
        pending = s.owner
          .post(`/api/payments/${paymentId}/reverse`)
          .then((res) => res);
        await sleep(HOLD_MS);
      });

      // Sin el bloqueo chocaría con el índice único y respondería 500.
      const res = await pending;
      expect(res.status).toBe(400);
      expect(body(res).message).toBe('Este movimiento ya fue reversado');
    });
  });

  describe('GET movimientos', () => {
    it('lista los movimientos de una deuda y filtra por tipo', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      const payment = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 40, method: 'CASH' })
        .expect(201);
      await s.owner
        .post(`/api/payments/${body(payment).id as string}/reverse`)
        .expect(201);

      const all = await s.viewer
        .get(`/api/debts/${debt.id}/payments`)
        .expect(200);
      expect(body(all).meta).toMatchObject({ total: 2 });

      const reversals = await s.viewer
        .get(`/api/debts/${debt.id}/payments?type=REVERSAL`)
        .expect(200);
      expect(
        (body(reversals).data as Body[]).map((p) => p.type as string),
      ).toEqual(['REVERSAL']);
    });

    it('no muestra los movimientos de otro negocio', async () => {
      const s = await scenario();
      await s.owner.get(`/api/debts/${s.otherDebt.id}/payments`).expect(404);

      await t.prisma.payment.create({
        data: {
          debtId: s.otherDebt.id,
          businessId: s.otherDebt.businessId,
          amount: 10,
          createdBy: s.otherDebt.createdBy,
        },
      });
      const res = await s.owner.get('/api/payments').expect(200);
      expect(body(res).meta).toMatchObject({ total: 0 });
    });
  });
});
