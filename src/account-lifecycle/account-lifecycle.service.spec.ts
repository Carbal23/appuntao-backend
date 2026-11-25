import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { AuditAction } from 'src/audit/audit.types';
import {
  AccountLifecycleService,
  PURGE_BATCH_SIZE,
} from './account-lifecycle.service';

const BUSINESS_ID = 'business-1';

const rows = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));

/** Prisma de mentira para `purgeBusiness`, con `payments` pagos en el negocio. */
function createPrisma(payments: number, inactivatedAt: Date | null) {
  const model = (found: { id: string }[] = []) => ({
    findMany: jest.fn().mockResolvedValue(found),
    deleteMany: jest.fn().mockResolvedValue({ count: found.length }),
  });

  const tx = {
    business: {
      findUnique: jest.fn().mockResolvedValue({ inactivatedAt }),
      delete: jest.fn().mockResolvedValue({}),
    },
    debtor: model(rows('debtor', 3)),
    debt: model(rows('debt', 5)),
    payment: model(rows('payment', payments)),
    paymentGroup: model(),
    invitation: model(),
    businessUser: model(rows('member', 2)),
    businessOwnershipTransfer: model(),
    auditLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

async function createService(payments: number, inactivatedAt: Date | null) {
  const { prisma, tx } = createPrisma(payments, inactivatedAt);
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccountLifecycleService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
      { provide: AuthLogService, useValue: { record: jest.fn() } },
    ],
  }).compile();
  return { service: moduleRef.get(AccountLifecycleService), tx };
}

describe('AccountLifecycleService', () => {
  describe('purgeBusiness', () => {
    it('no toca un negocio activo', async () => {
      const { service, tx } = await createService(10, null);

      await expect(service.purgeBusiness(BUSINESS_ID)).resolves.toBe(false);
      expect(tx.payment.deleteMany).not.toHaveBeenCalled();
      expect(tx.business.delete).not.toHaveBeenCalled();
    });

    it('borra la auditoría por lotes en un negocio grande', async () => {
      // 1 negocio + 3 clientes + 5 deudas + 2 miembros + 2.500 pagos.
      const payments = 2500;
      const total = 1 + 3 + 5 + 2 + payments;
      const { service, tx } = await createService(payments, new Date());

      await expect(service.purgeBusiness(BUSINESS_ID)).resolves.toBe(true);

      const calls = tx.auditLog.deleteMany.mock.calls as [
        { where: { entityId: { in: string[] } } },
      ][];
      expect(calls).toHaveLength(Math.ceil(total / PURGE_BATCH_SIZE));
      for (const [args] of calls) {
        expect(args.where.entityId.in.length).toBeLessThanOrEqual(
          PURGE_BATCH_SIZE,
        );
      }
      const deletedIds = calls.flatMap(([args]) => args.where.entityId.in);
      expect(new Set(deletedIds).size).toBe(total);
      expect(deletedIds).toContain(BUSINESS_ID);
    });

    it('conserva las descargas del dueño y deja el registro de la purga', async () => {
      const { service, tx } = await createService(1, new Date());

      await service.purgeBusiness(BUSINESS_ID);

      const [[args]] = tx.auditLog.deleteMany.mock.calls as [
        { where: { action: { notIn: string[] } } },
      ][];
      expect(args.where.action.notIn).toEqual([
        AuditAction.BUSINESS_DATA_EXPORTED,
        AuditAction.BUSINESS_PURGED,
      ]);
      const [[purged]] = tx.auditLog.create.mock.calls as [
        { data: { action: string; entityId: string } },
      ][];
      expect(purged.data).toMatchObject({
        action: AuditAction.BUSINESS_PURGED,
        entityId: BUSINESS_ID,
      });
    });

    it('borra cada tabla antes de las que referencia', async () => {
      const { service, tx } = await createService(1, new Date());

      await service.purgeBusiness(BUSINESS_ID);

      const order = [
        tx.payment.deleteMany,
        tx.paymentGroup.deleteMany,
        tx.debt.deleteMany,
        tx.invitation.deleteMany,
        tx.debtor.deleteMany,
        tx.businessUser.deleteMany,
        tx.business.delete,
      ].map((fn) => fn.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });
  });
});
