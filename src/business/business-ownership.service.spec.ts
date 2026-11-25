import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BusinessUserRole, OwnershipTransferStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditService } from 'src/audit/audit.service';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { EmailProvider } from 'src/providers/email.provider';
import { BusinessOwnershipService } from './business-ownership.service';
import { MAX_ACTIVE_OWNED_BUSINESSES } from './business-cap';

const OWNER_ID = 'owner-1';
const MEMBER_ID = 'member-1';
const BUSINESS_ID = 'business-1';

const pendingTransfer = {
  id: 'transfer-1',
  businessId: BUSINESS_ID,
  fromUserId: OWNER_ID,
  toUserId: MEMBER_ID,
  status: OwnershipTransferStatus.PENDING,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  respondedAt: null,
  createdAt: new Date(),
};

/**
 * Prisma de mentira para `acceptTransfer`. `activeOwned` es cuántos negocios
 * activos tiene ya quien acepta.
 */
function createPrisma(activeOwned: number) {
  const tx = {
    // 1.ª llamada: bloqueo del negocio. 2.ª: bloqueo del usuario (tope).
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: BUSINESS_ID,
          name: 'Tienda',
          ownerId: OWNER_ID,
          inactivatedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ id: MEMBER_ID }]),
    business: {
      count: jest.fn().mockResolvedValue(activeOwned),
      update: jest.fn().mockResolvedValue({}),
    },
    businessUser: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'membership-1',
        role: BusinessUserRole.ADMIN,
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    businessOwnershipTransfer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    businessOwnershipTransfer: {
      findUnique: jest.fn().mockResolvedValue(pendingTransfer),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // El aviso por correo es de mejor esfuerzo: sin datos, no se envía.
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    business: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  return { prisma, tx };
}

async function createService(activeOwned: number) {
  const { prisma, tx } = createPrisma(activeOwned);
  const audit = { log: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      BusinessOwnershipService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: EmailProvider, useValue: {} },
      { provide: AuthLogService, useValue: { record: jest.fn() } },
    ],
  }).compile();

  return {
    service: moduleRef.get(BusinessOwnershipService),
    prisma,
    tx,
    audit,
  };
}

describe('BusinessOwnershipService', () => {
  describe('acceptTransfer', () => {
    it('pasa el negocio al miembro y deja al dueño anterior como ADMIN', async () => {
      const { service, tx } = await createService(0);

      await expect(
        service.acceptTransfer(pendingTransfer.id, MEMBER_ID),
      ).resolves.toEqual({ message: 'Ahora eres el dueño de Tienda' });

      expect(tx.business.update).toHaveBeenCalledWith({
        where: { id: BUSINESS_ID },
        data: { ownerId: MEMBER_ID },
      });
      expect(tx.businessUser.update).toHaveBeenCalledWith({
        where: { id: 'membership-1' },
        data: { role: BusinessUserRole.OWNER },
      });
      expect(tx.businessUser.updateMany).toHaveBeenCalledWith({
        where: { businessId: BUSINESS_ID, userId: OWNER_ID },
        data: { role: BusinessUserRole.ADMIN },
      });
    });

    it('respeta el tope de negocios activos de quien acepta', async () => {
      const { service, tx } = await createService(MAX_ACTIVE_OWNED_BUSINESSES);

      await expect(
        service.acceptTransfer(pendingTransfer.id, MEMBER_ID),
      ).rejects.toThrow(BadRequestException);

      expect(tx.business.update).not.toHaveBeenCalled();
      expect(tx.businessOwnershipTransfer.updateMany).not.toHaveBeenCalled();
    });

    it('no cancela la propuesta al llegar al tope: queda pendiente', async () => {
      const { service, prisma } = await createService(
        MAX_ACTIVE_OWNED_BUSINESSES,
      );

      await expect(
        service.acceptTransfer(pendingTransfer.id, MEMBER_ID),
      ).rejects.toThrow('Cierra uno para poder quedarte con este');

      // Fuera de la transacción solo se cierra la propuesta cuando ya no
      // puede aceptarse (negocio cerrado, dueño distinto, ya no es miembro).
      expect(
        prisma.businessOwnershipTransfer.updateMany,
      ).not.toHaveBeenCalled();
    });
  });
});
