import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthLogEvent } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { EmailProvider } from 'src/providers/email.provider';
import { createCodeHasher } from 'src/auth/one-time-code';
import {
  EmailVerificationService,
  VERIFY_CODE_DAILY_LIMIT,
  VERIFY_CODE_MAX_ATTEMPTS,
} from './email-verification.service';

const SECRET = 's'.repeat(32);
const EMAIL = 'ana@test.com';
const codes = createCodeHasher(SECRET, 'email-verification-code');

const unverifiedUser = {
  id: 'user-1',
  email: EMAIL,
  emailVerifiedAt: null as Date | null,
};

const activeCode = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  userId: 'user-1',
  email: EMAIL,
  codeHash: codes.hash('123456'),
  attempts: 0,
  usedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

interface Options {
  required?: boolean;
  user?: typeof unverifiedUser | null;
  recent?: { createdAt: Date }[];
  code?: ReturnType<typeof activeCode> | null;
  attemptsLeft?: boolean;
  emailStillMatches?: boolean;
}

async function createService(options: Options = {}) {
  const {
    required = true,
    user = unverifiedUser,
    recent = [],
    code = activeCode(),
    attemptsLeft = true,
    emailStillMatches = true,
  } = options;

  const tx = {
    emailVerification: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: emailStillMatches ? 1 : 0 }),
    },
  };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(user) },
    emailVerification: {
      findMany: jest.fn().mockResolvedValue(recent),
      findFirst: jest.fn().mockResolvedValue(code),
      updateMany: jest.fn().mockResolvedValue({ count: attemptsLeft ? 1 : 0 }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
  };
  const authLog = { record: jest.fn() };
  const sendEmailVerificationCode = jest
    .fn()
    .mockResolvedValue({ error: null });

  const moduleRef = await Test.createTestingModule({
    providers: [
      EmailVerificationService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuthLogService, useValue: authLog },
      { provide: EmailProvider, useValue: { sendEmailVerificationCode } },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: () => SECRET,
          get: (key: string) =>
            key === 'account.requireEmailVerification' ? required : undefined,
        },
      },
    ],
  }).compile();

  const service = moduleRef.get(EmailVerificationService);
  const events = () =>
    (authLog.record.mock.calls as [{ event: AuthLogEvent }][]).map(
      ([params]) => params.event,
    );
  return { service, prisma, tx, sendEmailVerificationCode, events };
}

describe('EmailVerificationService', () => {
  describe('isPending', () => {
    it('solo cuando el entorno lo exige y el correo no está verificado', async () => {
      const on = (await createService({ required: true })).service;
      const off = (await createService({ required: false })).service;

      expect(on.isPending({ email: EMAIL, emailVerifiedAt: null })).toBe(true);
      expect(on.isPending({ email: EMAIL, emailVerifiedAt: new Date() })).toBe(
        false,
      );
      expect(on.isPending({ email: null, emailVerifiedAt: null })).toBe(false);
      expect(off.isPending({ email: EMAIL, emailVerifiedAt: null })).toBe(
        false,
      );
    });
  });

  describe('sendCode', () => {
    it('responde lo mismo exista o no la cuenta', async () => {
      const withAccount = (await createService()).service;
      const without = (await createService({ user: null })).service;

      expect(withAccount.sendCode(EMAIL)).toEqual(without.sendCode(EMAIL));
    });

    it('envía un código a una cuenta sin verificar y anula los anteriores', async () => {
      const { service, prisma, sendEmailVerificationCode, events } =
        await createService();

      await service['issueCode'](EMAIL);

      expect(prisma.emailVerification.updateMany).toHaveBeenCalled();
      const [[created]] = prisma.emailVerification.create.mock.calls as [
        { data: { userId: string; email: string; codeHash: string } },
      ][];
      expect(created.data).toMatchObject({ userId: 'user-1', email: EMAIL });
      expect(sendEmailVerificationCode).toHaveBeenCalledWith(
        EMAIL,
        expect.stringMatching(/^\d{6}$/),
        15,
      );
      expect(events()).toEqual([AuthLogEvent.EMAIL_VERIFICATION_REQUESTED]);
    });

    it('no envía nada si el correo ya está verificado o no hay cuenta', async () => {
      for (const user of [
        { ...unverifiedUser, emailVerifiedAt: new Date() },
        null,
      ]) {
        const { service, sendEmailVerificationCode } = await createService({
          user,
        });

        await service['issueCode'](EMAIL);

        expect(sendEmailVerificationCode).not.toHaveBeenCalled();
      }
    });

    it('espera un minuto entre dos códigos', async () => {
      const { service, sendEmailVerificationCode } = await createService({
        recent: [{ createdAt: new Date(Date.now() - 10_000) }],
      });

      await service['issueCode'](EMAIL);

      expect(sendEmailVerificationCode).not.toHaveBeenCalled();
    });

    it('no pasa de 5 códigos al día y lo registra', async () => {
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const { service, sendEmailVerificationCode, events } =
        await createService({
          recent: Array.from({ length: VERIFY_CODE_DAILY_LIMIT }, () => ({
            createdAt: old,
          })),
        });

      await service['issueCode'](EMAIL);

      expect(sendEmailVerificationCode).not.toHaveBeenCalled();
      expect(events()).toEqual([AuthLogEvent.EMAIL_VERIFICATION_BLOCKED]);
    });
  });

  describe('verify', () => {
    it('con el código correcto marca el correo como verificado', async () => {
      const { service, tx, events } = await createService();

      await expect(
        service.verify({ email: EMAIL, code: '123456' }),
      ).resolves.toEqual({
        message: 'Tu correo quedó verificado. Ya puedes iniciar sesión.',
      });

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', email: EMAIL },
        data: { emailVerifiedAt: expect.any(Date) as Date },
      });
      expect(events()).toEqual([AuthLogEvent.EMAIL_VERIFIED]);
    });

    it('con un código equivocado responde 400 y no verifica', async () => {
      const { service, tx, events } = await createService();

      await expect(
        service.verify({ email: EMAIL, code: '000000' }),
      ).rejects.toThrow(BadRequestException);

      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(events()).toEqual([AuthLogEvent.EMAIL_VERIFICATION_FAILED]);
    });

    it('el último intento fallido bloquea el código', async () => {
      const { service, events } = await createService({
        code: activeCode({ attempts: VERIFY_CODE_MAX_ATTEMPTS - 1 }),
      });

      await expect(
        service.verify({ email: EMAIL, code: '000000' }),
      ).rejects.toThrow(BadRequestException);

      expect(events()).toEqual([
        AuthLogEvent.EMAIL_VERIFICATION_FAILED,
        AuthLogEvent.EMAIL_VERIFICATION_BLOCKED,
      ]);
    });

    it('sin intentos disponibles rechaza aunque el código sea correcto', async () => {
      const { service, tx } = await createService({ attemptsLeft: false });

      await expect(
        service.verify({ email: EMAIL, code: '123456' }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it('sin código vigente responde el mismo error que un código malo', async () => {
      const { service } = await createService({ code: null });

      await expect(
        service.verify({ email: EMAIL, code: '123456' }),
      ).rejects.toThrow(
        'El código no es válido o ya venció. Revísalo o pide uno nuevo.',
      );
    });

    it('un código del correo anterior no verifica el correo nuevo', async () => {
      const { service } = await createService({ emailStillMatches: false });

      await expect(
        service.verify({ email: EMAIL, code: '123456' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
