import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthLogEvent } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { AuthLogReason } from 'src/auth-log/auth-log.types';
import { LegalService } from 'src/legal/legal.service';
import { AccountLifecycleService } from 'src/account-lifecycle/account-lifecycle.service';
import { EmailVerificationService } from 'src/email-verification/email-verification.service';
import { AuthService } from './auth.service';

const PASSWORD = 'Clave2026';

const user = {
  id: 'user-1',
  email: 'ana@test.com',
  phone: '3001234567',
  password: bcrypt.hashSync(PASSWORD, 4),
  firstName: 'Ana',
  lastName: 'Gómez',
  documentType: 'CC',
  documentNumber: '1032876361',
  role: 'USER',
  emailVerifiedAt: null,
  inactivatedAt: null,
  inactivatedBy: null,
  deletionRequestedAt: null,
  deletionScheduledAt: null,
  anonymizedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const loginDto = {
  identifier: 'ana@test.com',
  password: PASSWORD,
  deviceId: 'device-123456',
  deviceName: 'Prueba',
};

async function createService(emailPending: boolean) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([user]),
      findFirst: jest.fn().mockResolvedValue(user),
    },
    refreshToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest
        .fn()
        .mockResolvedValue({ expiresAt: new Date(Date.now() + 86_400_000) }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'family-1',
        deviceId: loginDto.deviceId,
        deviceName: null,
        rotatedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    },
  };
  const authLog = { record: jest.fn() };
  const emailVerification = {
    isPending: jest.fn().mockReturnValue(emailPending),
    sendCode: jest.fn(),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: JwtService,
        useValue: { signAsync: jest.fn().mockResolvedValue('access-token') },
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) =>
            key === 'jwt.refreshTokenExpiresDays' ? 30 : '15m',
        },
      },
      { provide: AuthLogService, useValue: authLog },
      {
        provide: LegalService,
        useValue: { getPendingDocuments: jest.fn().mockResolvedValue([]) },
      },
      {
        provide: AccountLifecycleService,
        useValue: { loginState: () => 'ACTIVE' },
      },
      { provide: EmailVerificationService, useValue: emailVerification },
    ],
  }).compile();

  return {
    service: moduleRef.get(AuthService),
    prisma,
    authLog,
    emailVerification,
  };
}

describe('AuthService', () => {
  describe('login con el correo sin verificar', () => {
    it('responde 403 EMAIL_NOT_VERIFIED con el correo, sin emitir tokens', async () => {
      const { service, prisma } = await createService(true);

      const error = await service.login(loginDto).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        error: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('le envía un código y deja el intento en AuthLog', async () => {
      const { service, authLog, emailVerification } = await createService(true);

      await service.login(loginDto).catch(() => undefined);

      expect(emailVerification.sendCode).toHaveBeenCalledWith(
        user.email,
        undefined,
      );
      expect(authLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          event: AuthLogEvent.LOGIN_FAILED,
          reason: AuthLogReason.EMAIL_NOT_VERIFIED,
        }),
      );
    });

    it('con la contraseña mala responde 401, sin revelar que falta verificar', async () => {
      const { service, emailVerification } = await createService(true);

      await expect(
        service.login({ ...loginDto, password: 'otra-clave-1' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(emailVerification.sendCode).not.toHaveBeenCalled();
    });
  });

  describe('login sin verificación pendiente', () => {
    it('entra normal', async () => {
      const { service, emailVerification } = await createService(false);

      await expect(service.login(loginDto)).resolves.toMatchObject({
        accessToken: 'access-token',
      });
      expect(emailVerification.sendCode).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    it('no renueva la sesión de un correo sin verificar', async () => {
      const { service } = await createService(true);

      await expect(
        service.refreshTokens(`${user.id}.raw-token`, loginDto.deviceId),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
