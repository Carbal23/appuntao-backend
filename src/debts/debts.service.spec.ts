import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DebtStatus, Prisma } from '@prisma/client';
import { AuditService } from 'src/audit/audit.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DebtsService } from './debts.service';

/**
 * Reglas del service sin base de datos. El SQL, los bloqueos y los filtros
 * contra datos reales están en test/debts.db-spec.ts.
 */

const NOW = new Date('2026-11-27T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function setup() {
  const calls: string[] = [];
  const debtorFindFirst = jest.fn(() =>
    Promise.resolve({
      id: 'debtor-1',
      inactivatedAt: null as Date | null,
      business: { currency: 'COP' },
    }),
  );
  const queryRaw = jest.fn(() => {
    calls.push('lock');
    return Promise.resolve([{ id: 'business-1' }]);
  });
  const debtCreate = jest.fn(() =>
    Promise.resolve({ id: 'debt-1', amount: new Prisma.Decimal(100) }),
  );
  const debtFindFirst = jest.fn();
  const debtFindMany = jest.fn(() => Promise.resolve([]));
  const debtCount = jest.fn(() => Promise.resolve(0));
  const debtUpdate = jest.fn(() =>
    Promise.resolve({
      amount: new Prisma.Decimal(100),
      balance: new Prisma.Decimal(100),
      debtor: { id: 'debtor-1' },
    }),
  );
  const auditLog = jest.fn(() => Promise.resolve());

  const tx = {
    $queryRaw: queryRaw,
    debt: { create: debtCreate, findFirst: debtFindFirst, update: debtUpdate },
  };
  const prisma = {
    debtor: { findFirst: debtorFindFirst },
    debt: { findMany: debtFindMany, count: debtCount },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  /** El `where` de la última consulta del listado. */
  const lastWhere = () => {
    const [args] = debtFindMany.mock.calls.at(-1) as unknown as [
      { where: { AND: Prisma.DebtWhereInput[] } },
    ];
    return args.where.AND;
  };

  return {
    calls,
    prisma,
    auditLog,
    debtorFindFirst,
    queryRaw,
    debtCreate,
    debtFindFirst,
    debtUpdate,
    lastWhere,
  };
}

async function build(mocks: ReturnType<typeof setup>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      DebtsService,
      { provide: PrismaService, useValue: mocks.prisma },
      { provide: AuditService, useValue: { log: mocks.auditLog } },
    ],
  }).compile();
  return moduleRef.get(DebtsService);
}

describe('DebtsService', () => {
  describe('create (fiar)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const fiar = async (mocks: ReturnType<typeof setup>, dueDate?: Date) => {
      const service = await build(mocks);
      return service.create(
        { debtorId: 'debtor-1', amount: 100, dueDate },
        'user-1',
        'business-1',
      );
    };

    it('acepta un vencimiento de hasta un día atrás (reloj adelantado o fin del día local)', async () => {
      const mocks = setup();
      await fiar(mocks, new Date(NOW.getTime() - 23 * HOUR));
      expect(mocks.debtCreate).toHaveBeenCalled();
    });

    it('rechaza uno de más de un día atrás sin abrir la transacción', async () => {
      const mocks = setup();
      await expect(
        fiar(mocks, new Date(NOW.getTime() - 25 * HOUR)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('usa la moneda del negocio y guarda saldo igual al monto', async () => {
      const mocks = setup();
      await fiar(mocks);

      const [[{ data }]] = mocks.debtCreate.mock.calls as unknown as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data).toMatchObject({
        currency: 'COP',
        amount: new Prisma.Decimal(100),
        balance: new Prisma.Decimal(100),
        description: null,
        dueDate: null,
      });
    });

    it('revisa que el negocio siga abierto dentro de la transacción', async () => {
      const mocks = setup();
      mocks.queryRaw.mockResolvedValueOnce([]);

      await expect(fiar(mocks)).rejects.toThrow(
        'El negocio se encuentra inactivado',
      );
      expect(mocks.debtCreate).not.toHaveBeenCalled();
    });

    it('cliente ajeno 404, cliente quitado 400', async () => {
      const mocks = setup();
      mocks.debtorFindFirst.mockResolvedValueOnce(null as never);
      await expect(fiar(mocks)).rejects.toBeInstanceOf(NotFoundException);

      mocks.debtorFindFirst.mockResolvedValueOnce({
        id: 'debtor-1',
        inactivatedAt: NOW,
        business: { currency: 'COP' },
      });
      await expect(fiar(mocks)).rejects.toThrow(
        'El cliente fue quitado de la lista del negocio; regístralo de nuevo para fiarle',
      );
    });
  });

  describe('findByBusiness (filtros)', () => {
    it('overdue suma su condición a status con AND', async () => {
      const mocks = setup();
      const service = await build(mocks);

      await service.findByBusiness('business-1', {
        status: DebtStatus.PARTIAL,
        overdue: true,
      });

      const and = mocks.lastWhere();
      expect(and).toContainEqual({ businessId: 'business-1' });
      expect(and).toContainEqual({ status: DebtStatus.PARTIAL });
      expect(and).toContainEqual(
        expect.objectContaining({
          status: { in: [DebtStatus.OPEN, DebtStatus.PARTIAL] },
          balance: { gt: 0 },
        }),
      );
    });

    it('una búsqueda de solo espacios no filtra', async () => {
      const mocks = setup();
      const service = await build(mocks);

      await service.findByBusiness('business-1', { search: '   ' });

      expect(mocks.lastWhere()).toEqual([{ businessId: 'business-1' }]);
    });
  });

  describe('updateStatus (anular)', () => {
    const anular = async (mocks: ReturnType<typeof setup>) => {
      const service = await build(mocks);
      return service.updateStatus('debt-1', 'user-1', 'business-1', {
        status: DebtStatus.CANCELLED,
      });
    };

    it('bloquea la deuda antes de mirar su estado', async () => {
      const mocks = setup();
      mocks.debtFindFirst.mockImplementation(() => {
        mocks.calls.push('debt.findFirst');
        return Promise.resolve({
          status: DebtStatus.OPEN,
          _count: { payments: 0 },
        });
      });

      await anular(mocks);

      expect(mocks.calls).toEqual(['lock', 'debt.findFirst']);
      expect(mocks.auditLog).toHaveBeenCalledTimes(1);
    });

    it.each([
      [DebtStatus.PARTIAL, 0],
      [DebtStatus.PAID, 0],
      [DebtStatus.OPEN, 1],
    ])(
      'no anula una deuda %s con %i abonos vigentes',
      async (status, payments) => {
        const mocks = setup();
        mocks.debtFindFirst.mockResolvedValue({
          status,
          _count: { payments },
        });

        await expect(anular(mocks)).rejects.toThrow(
          'No puedes anular una deuda con abonos o descuentos vigentes: reversa primero',
        );
        expect(mocks.debtUpdate).not.toHaveBeenCalled();
      },
    );
  });
});
