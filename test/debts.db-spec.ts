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
 * Debts por HTTP contra la base de pruebas (`appuntao_test`): fiar, listar y
 * filtrar, y anular. Ver docs/pruebas.md.
 */

type Body = Record<string, any>;
const body = (res: Response) => res.body as Body;
const DAY = 24 * 60 * 60 * 1000;
const fromNow = (ms: number) => new Date(Date.now() + ms);

describe('Debts (base real)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  /** Negocio con dueño, cajero y consultor, un cliente y un negocio ajeno. */
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
    const debtor = await createDebtor(t.prisma, business.id, 'Rosa Pérez');

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

    const debt = (
      amount: number,
      extra: Partial<Parameters<typeof createDebt>[1]> = {},
    ) =>
      createDebt(t.prisma, {
        businessId: business.id,
        debtorId: debtor.id,
        createdBy: owner.id,
        amount,
        ...extra,
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

  const ids = (res: Response) =>
    (body(res).data as Body[]).map((d) => d.id as string);

  describe('POST /api/debts (fiar)', () => {
    it('el cajero fía: saldo igual al monto, OPEN, moneda del negocio y auditoría', async () => {
      const s = await scenario();
      const dueDate = fromNow(7 * DAY).toISOString();

      const res = await s.cashier
        .post('/api/debts', {
          debtorId: s.debtor.id,
          amount: 25000.5,
          description: '  Mercado de la semana  ',
          dueDate,
        })
        .expect(201);

      const created = await t.prisma.debt.findUniqueOrThrow({
        where: { id: body(res).id as string },
      });
      expect(created).toMatchObject({
        status: DebtStatus.OPEN,
        currency: 'COP',
        description: 'Mercado de la semana',
        dueDate: new Date(dueDate),
      });
      expect(created.amount.toFixed(2)).toBe('25000.50');
      expect(created.balance.toFixed(2)).toBe('25000.50');

      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: created.id },
        select: { action: true },
      });
      expect(audit).toEqual([{ action: 'DEBT_CREATED' }]);
    });

    it('sin descripción ni vencimiento las deja nulas; vacía también queda nula', async () => {
      const s = await scenario();

      const res = await s.owner
        .post('/api/debts', {
          debtorId: s.debtor.id,
          amount: 100,
          description: '   ',
        })
        .expect(201);

      expect(body(res)).toMatchObject({ description: null, dueDate: null });
    });

    it('acepta que venza hoy aunque el reloj del celular vaya adelantado', async () => {
      const s = await scenario();

      await s.owner
        .post('/api/debts', {
          debtorId: s.debtor.id,
          amount: 100,
          dueDate: fromNow(-20 * 60 * 60 * 1000).toISOString(),
        })
        .expect(201);
    });

    it('rechaza un vencimiento de hace más de un día, con el error en el campo', async () => {
      const s = await scenario();

      const res = await s.owner
        .post('/api/debts', {
          debtorId: s.debtor.id,
          amount: 100,
          dueDate: fromNow(-2 * DAY).toISOString(),
        })
        .expect(400);

      expect(body(res).errors).toEqual({
        dueDate: 'La fecha de vencimiento no puede estar en el pasado',
      });
      expect(
        await t.prisma.debt.count({ where: { debtorId: s.debtor.id } }),
      ).toBe(0);
    });

    it.each([
      ['monto cero', { amount: 0 }],
      ['monto negativo', { amount: -10 }],
      ['más de dos decimales', { amount: 10.555 }],
      ['monto que no cabe en Decimal(12, 2)', { amount: 10_000_000_000 }],
      ['fecha inválida', { amount: 10, dueDate: 'mañana' }],
      [
        'descripción de 201 caracteres',
        { amount: 10, description: 'x'.repeat(201) },
      ],
      ['un campo de más', { amount: 10, balance: 0 }],
    ])('rechaza %s (400) sin crear nada', async (_, extra) => {
      const s = await scenario();

      await s.owner
        .post('/api/debts', { debtorId: s.debtor.id, ...extra })
        .expect(400);

      expect(
        await t.prisma.debt.count({ where: { debtorId: s.debtor.id } }),
      ).toBe(0);
    });

    it('guarda el monto más grande que cabe', async () => {
      const s = await scenario();

      const res = await s.owner
        .post('/api/debts', { debtorId: s.debtor.id, amount: 9_999_999_999.99 })
        .expect(201);

      expect((await debtState(t.prisma, body(res).id as string)).balance).toBe(
        '9999999999.99',
      );
    });

    it('no encuentra al cliente de otro negocio (404)', async () => {
      const s = await scenario();

      await s.owner
        .post('/api/debts', { debtorId: s.otherDebtor.id, amount: 100 })
        .expect(404);
      expect(
        await t.prisma.debt.count({ where: { debtorId: s.otherDebtor.id } }),
      ).toBe(1);
    });

    it('no le fía a un cliente quitado de la lista', async () => {
      const s = await scenario();
      await t.prisma.debtor.update({
        where: { id: s.debtor.id },
        data: { inactivatedAt: new Date() },
      });

      const res = await s.owner
        .post('/api/debts', { debtorId: s.debtor.id, amount: 100 })
        .expect(400);
      expect(body(res).message).toBe(
        'El cliente fue quitado de la lista del negocio; regístralo de nuevo para fiarle',
      );
    });

    it('en un negocio cerrado no se fía', async () => {
      const s = await scenario();
      await t.prisma.business.update({
        where: { id: s.business.id },
        data: { inactivatedAt: new Date() },
      });

      const res = await s.owner
        .post('/api/debts', { debtorId: s.debtor.id, amount: 100 })
        .expect(400);
      expect(body(res).message).toBe('El negocio se encuentra inactivado');
    });

    it('el consultor no puede fiar (403)', async () => {
      const s = await scenario();

      await s.viewer
        .post('/api/debts', { debtorId: s.debtor.id, amount: 100 })
        .expect(403);
    });

    it('quien no es miembro del negocio no puede fiar (403)', async () => {
      const s = await scenario();
      const stranger = await createUser(t.prisma, 'Ajeno');
      const token = await t.tokenFor(stranger);

      await asMember(t.app, token, s.business.id)
        .post('/api/debts', { debtorId: s.debtor.id, amount: 100 })
        .expect(403);
    });
  });

  describe('GET /api/debts (listar y filtrar)', () => {
    it('solo lista las del negocio, también para el consultor', async () => {
      const s = await scenario();
      const a = await s.debt(100);
      const b = await s.debt(200);

      const res = await s.viewer.get('/api/debts').expect(200);

      expect(ids(res).sort()).toEqual([a.id, b.id].sort());
      expect(body(res).meta).toMatchObject({ total: 2, page: 1, limit: 10 });
    });

    it('vencidas: se deben y la fecha ya pasó; no cuenta las pagadas ni las anuladas', async () => {
      const s = await scenario();
      const overdue = await s.debt(100, { dueDate: fromNow(-3 * DAY) });
      const partialOverdue = await s.debt(100, {
        dueDate: fromNow(-1 * DAY),
        status: DebtStatus.PARTIAL,
      });
      await s.debt(100, { dueDate: fromNow(3 * DAY) });
      await s.debt(100);
      const paid = await s.debt(100, {
        dueDate: fromNow(-3 * DAY),
        status: DebtStatus.PAID,
      });
      await t.prisma.debt.update({
        where: { id: paid.id },
        data: { balance: 0 },
      });
      await s.debt(100, {
        dueDate: fromNow(-3 * DAY),
        status: DebtStatus.CANCELLED,
      });

      const res = await s.owner.get('/api/debts?overdue=true').expect(200);

      expect(ids(res).sort()).toEqual([overdue.id, partialOverdue.id].sort());
    });

    it('overdue=false no filtra (antes "false" se leía como true)', async () => {
      const s = await scenario();
      await s.debt(100, { dueDate: fromNow(-3 * DAY) });
      await s.debt(100);

      const res = await s.owner.get('/api/debts?overdue=false').expect(200);
      expect(body(res).meta).toMatchObject({ total: 2 });
    });

    it('status y overdue juntos respetan los dos filtros', async () => {
      const s = await scenario();
      await s.debt(100, { dueDate: fromNow(-3 * DAY) });
      const partial = await s.debt(100, {
        dueDate: fromNow(-3 * DAY),
        status: DebtStatus.PARTIAL,
      });
      await s.debt(100, { status: DebtStatus.PARTIAL });

      const res = await s.owner
        .get('/api/debts?overdue=true&status=PARTIAL')
        .expect(200);
      expect(ids(res)).toEqual([partial.id]);
    });

    it('busca en la descripción y en el nombre del cliente, sin importar mayúsculas', async () => {
      const s = await scenario();
      const byDescription = await s.debt(100, {
        description: 'Arroz y PANELA',
      });
      await s.debt(100, { description: 'Gaseosa' });
      const otherClient = await createDebtor(
        t.prisma,
        s.business.id,
        'Panelería Juan',
      );
      const byName = await createDebt(t.prisma, {
        businessId: s.business.id,
        debtorId: otherClient.id,
        createdBy: s.business.ownerId,
        amount: 50,
      });

      const res = await s.owner.get('/api/debts?search=panel').expect(200);
      expect(ids(res).sort()).toEqual([byDescription.id, byName.id].sort());
    });

    it('ordena por monto y pagina sin repetir ni saltar deudas', async () => {
      const s = await scenario();
      const sameDate = new Date(Date.UTC(2026, 0, 1));
      const created = await Promise.all(
        [50, 10, 40, 20, 30].map((amount) =>
          s.debt(amount, { createdAt: sameDate }),
        ),
      );

      const byAmount = await s.owner
        .get('/api/debts?sortBy=amount&order=asc')
        .expect(200);
      expect(
        (body(byAmount).data as Body[]).map((d) => Number(d.amount)),
      ).toEqual([10, 20, 30, 40, 50]);

      // Todas con la misma fecha: el id desempata y las páginas no se cruzan.
      const pages = await Promise.all(
        [1, 2, 3].map((page) =>
          s.owner.get(`/api/debts?limit=2&page=${page}`).expect(200),
        ),
      );
      const seen = pages.flatMap(ids);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(created.map((d) => d.id)));
    });

    it.each([
      ['sortBy=password'],
      ['order=up'],
      ['status=PAGADA'],
      ['overdue=si'],
      ['limit=101'],
      ['page=0'],
    ])('rechaza %s (400)', async (query) => {
      const s = await scenario();
      await s.owner.get(`/api/debts?${query}`).expect(400);
    });
  });

  describe('GET /api/debtors/:debtorId/debts', () => {
    it('lista solo las del cliente', async () => {
      const s = await scenario();
      const mine = await s.debt(100);
      const other = await createDebtor(t.prisma, s.business.id, 'Otro');
      await createDebt(t.prisma, {
        businessId: s.business.id,
        debtorId: other.id,
        createdBy: s.business.ownerId,
        amount: 100,
      });

      const res = await s.viewer
        .get(`/api/debtors/${s.debtor.id}/debts`)
        .expect(200);
      expect(ids(res)).toEqual([mine.id]);
    });

    it('un cliente de otro negocio o quitado de la lista responde 404', async () => {
      const s = await scenario();
      await s.owner.get(`/api/debtors/${s.otherDebtor.id}/debts`).expect(404);

      await t.prisma.debtor.update({
        where: { id: s.debtor.id },
        data: { inactivatedAt: new Date() },
      });
      await s.owner.get(`/api/debtors/${s.debtor.id}/debts`).expect(404);
    });
  });

  describe('PATCH /api/debts/:id/status (anular)', () => {
    const cancel = { status: 'CANCELLED' };

    it('el dueño anula una deuda sin abonos y queda la auditoría', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const res = await s.owner
        .patch(`/api/debts/${debt.id}/status`, cancel)
        .expect(200);

      expect(body(res).status).toBe(DebtStatus.CANCELLED);
      expect((await debtState(t.prisma, debt.id)).status).toBe(
        DebtStatus.CANCELLED,
      );
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: debt.id, action: 'DEBT_CANCELLED' },
      });
      expect(audit.meta).toMatchObject({
        previousStatus: 'OPEN',
        newStatus: 'CANCELLED',
        amount: 100,
      });
    });

    it('no se anula dos veces', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.owner.patch(`/api/debts/${debt.id}/status`, cancel).expect(200);
      const res = await s.owner
        .patch(`/api/debts/${debt.id}/status`, cancel)
        .expect(400);
      expect(body(res).message).toBe('La deuda ya está anulada');
    });

    it('con un abono vigente no se anula; reversado sí', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      const payment = await s.owner
        .post('/api/payments', { debtId: debt.id, amount: 40, method: 'CASH' })
        .expect(201);

      const res = await s.owner
        .patch(`/api/debts/${debt.id}/status`, cancel)
        .expect(400);
      expect(body(res).message).toBe(
        'No puedes anular una deuda con abonos o descuentos vigentes: reversa primero',
      );

      await s.owner
        .post(`/api/payments/${body(payment).id as string}/reverse`)
        .expect(201);
      await s.owner.patch(`/api/debts/${debt.id}/status`, cancel).expect(200);
    });

    it('con un descuento vigente tampoco se anula', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      await s.owner
        .post('/api/payments/discounts', {
          debtId: debt.id,
          amount: 100,
          reason: 'Cliente de siempre',
        })
        .expect(201);

      await s.owner.patch(`/api/debts/${debt.id}/status`, cancel).expect(400);
    });

    it.each([['OPEN'], ['PAID'], ['PARTIAL'], ['ANULADA']])(
      'solo se puede pasar a CANCELLED, no a %s (400)',
      async (status) => {
        const s = await scenario();
        const debt = await s.debt(100);

        await s.owner
          .patch(`/api/debts/${debt.id}/status`, { status })
          .expect(400);
        expect((await debtState(t.prisma, debt.id)).status).toBe(
          DebtStatus.OPEN,
        );
      },
    );

    it('el cajero no puede anular (403)', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      await s.cashier.patch(`/api/debts/${debt.id}/status`, cancel).expect(403);
    });

    it('no encuentra la deuda de otro negocio (404) y no la toca', async () => {
      const s = await scenario();

      await s.owner
        .patch(`/api/debts/${s.otherDebt.id}/status`, cancel)
        .expect(404);
      expect((await debtState(t.prisma, s.otherDebt.id)).status).toBe(
        DebtStatus.OPEN,
      );
    });

    it('anular y abonar a la vez: o se anula sin abonos o queda el abono sin anular', async () => {
      const s = await scenario();
      const debt = await s.debt(100);

      const [cancelRes, payRes] = await Promise.all([
        s.owner.patch(`/api/debts/${debt.id}/status`, cancel),
        s.cashier.post('/api/payments', {
          debtId: debt.id,
          amount: 40,
          method: 'CASH',
        }),
      ]);

      const state = await debtState(t.prisma, debt.id);
      const payments = await t.prisma.payment.count({
        where: { debtId: debt.id },
      });
      if (cancelRes.status === 200) {
        expect(payRes.status).toBe(400);
        expect(state.status).toBe(DebtStatus.CANCELLED);
        expect(payments).toBe(0);
      } else {
        expect(payRes.status).toBe(201);
        expect(state).toEqual({ balance: '60.00', status: DebtStatus.PARTIAL });
        expect(payments).toBe(1);
      }
    });
  });

  /**
   * Como en payments: otra transacción tiene la fila bloqueada y la cambia
   * sin confirmar. La petición tiene que esperar y ver el cambio.
   */
  describe('bloqueos', () => {
    const HOLD_MS = 500;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('anular espera al abono que tiene la deuda bloqueada y no la anula', async () => {
      const s = await scenario();
      const debt = await s.debt(100);
      let pending!: Promise<Response>;

      await t.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Debt" WHERE id = ${debt.id} FOR UPDATE`;
          await tx.payment.create({
            data: {
              debtId: debt.id,
              businessId: debt.businessId,
              amount: 40,
              type: PaymentType.PAYMENT,
              createdBy: debt.createdBy,
            },
          });
          await tx.debt.update({
            where: { id: debt.id },
            data: { balance: 60, status: DebtStatus.PARTIAL },
          });
          pending = s.owner
            .patch(`/api/debts/${debt.id}/status`, { status: 'CANCELLED' })
            .then((res) => res);
          await sleep(HOLD_MS);
        },
        { timeout: 15_000 },
      );

      const res = await pending;
      expect(res.status).toBe(400);
      expect(await debtState(t.prisma, debt.id)).toEqual({
        balance: '60.00',
        status: DebtStatus.PARTIAL,
      });
    });

    it('fiar espera a que termine de cerrarse el negocio y entonces se rechaza', async () => {
      const s = await scenario();
      let pending!: Promise<Response>;

      // Cerrar el negocio toma la fila con FOR UPDATE, como business.service.
      await t.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "Business" WHERE id = ${s.business.id} FOR UPDATE`;
          await tx.business.update({
            where: { id: s.business.id },
            data: { inactivatedAt: new Date() },
          });
          pending = s.owner
            .post('/api/debts', { debtorId: s.debtor.id, amount: 100 })
            .then((res) => res);
          await sleep(HOLD_MS);
        },
        { timeout: 15_000 },
      );

      const res = await pending;
      expect(res.status).toBe(400);
      expect(body(res).message).toBe('El negocio se encuentra inactivado');
      expect(
        await t.prisma.debt.count({ where: { businessId: s.business.id } }),
      ).toBe(0);
    });
  });

  it('el saldo guardado siempre cuadra con los movimientos', async () => {
    // Fiar, abonar con centavos, descontar y reversar; el saldo guardado
    // tiene que ser monto − abonos − descuentos + reversos, calculado en SQL.
    const s = await scenario();
    const debt = await s.debt(500);
    const p1 = await s.owner
      .post('/api/payments', {
        debtId: debt.id,
        amount: 120.35,
        method: 'CASH',
      })
      .expect(201);
    await s.owner
      .post('/api/payments/discounts', {
        debtId: debt.id,
        amount: 79.65,
        reason: 'Redondeo',
      })
      .expect(201);
    await s.owner
      .post(`/api/payments/${body(p1).id as string}/reverse`)
      .expect(201);

    const rows = await t.prisma.$queryRaw<
      { balance: Prisma.Decimal; expected: Prisma.Decimal }[]
    >`
      SELECT d.balance,
             d.amount - COALESCE(SUM(CASE WHEN p.type = 'REVERSAL' THEN -p.amount ELSE p.amount END), 0) AS expected
      FROM "Debt" d LEFT JOIN "Payment" p ON p."debtId" = d.id
      WHERE d.id = ${debt.id}
      GROUP BY d.id`;
    // 500 − 120,35 − 79,65 + 120,35
    expect(rows[0].expected.toFixed(2)).toBe('420.35');
    expect(rows[0].balance.toFixed(2)).toBe(rows[0].expected.toFixed(2));
  });
});
