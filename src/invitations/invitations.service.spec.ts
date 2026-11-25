import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvitationStatus, InvitationType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditService } from 'src/audit/audit.service';
import { EmailProvider } from 'src/providers/email.provider';
import type { UserSafe } from 'src/users/user.select';
import { InvitationsService } from './invitations.service';

const CODE = 'K7M2PQ9XAB';

const invitation = {
  id: 'invitation-1',
  businessId: 'business-1',
  debtorId: 'debtor-1',
  email: null,
  phone: '3001234567',
  code: CODE,
  expiresAt: new Date(Date.now() + 86_400_000),
  status: InvitationStatus.PENDING,
  type: InvitationType.DEBTOR,
  role: null,
  createdById: 'owner-1',
  acceptedById: null,
  respondedAt: null,
  createdAt: new Date(),
};

const recipient = {
  id: 'user-1',
  email: 'ana@test.com',
  phone: '3001234567',
} as UserSafe;

async function createService() {
  const tx = {
    invitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    debtor: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    invitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
    business: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'business-1',
        name: 'Tienda',
        ownerId: 'owner-1',
        inactivatedAt: null,
      }),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      InvitationsService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: EmailProvider, useValue: {} },
    ],
  }).compile();

  return { service: moduleRef.get(InvitationsService), tx };
}

describe('InvitationsService', () => {
  describe('acceptById', () => {
    it('exige el código de la invitación', async () => {
      const { service, tx } = await createService();

      const error = await service
        .acceptById(invitation.id, 'AAAAAAAAAA', recipient)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        error: 'INVITATION_CODE_MISMATCH',
      });
      expect(tx.invitation.updateMany).not.toHaveBeenCalled();
    });

    it('con el código correcto vincula la ficha del cliente', async () => {
      const { service, tx } = await createService();

      await expect(
        service.acceptById(invitation.id, CODE, recipient),
      ).resolves.toMatchObject({ type: InvitationType.DEBTOR });

      expect(tx.debtor.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: recipient.id } }),
      );
    });

    it('acepta el código escrito en minúsculas, con espacios o guiones', async () => {
      const { service } = await createService();

      await expect(
        service.acceptById(invitation.id, 'k7m2-pq9 xab', recipient),
      ).resolves.toMatchObject({ businessId: 'business-1' });
    });

    it('con el código correcto pero otra persona, responde 403', async () => {
      const { service, tx } = await createService();
      const stranger = {
        id: 'user-2',
        email: 'otro@test.com',
        phone: '3109999999',
      } as UserSafe;

      await expect(
        service.acceptById(invitation.id, CODE, stranger),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.invitation.updateMany).not.toHaveBeenCalled();
    });
  });
});
