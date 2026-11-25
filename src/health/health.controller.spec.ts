import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { DB_CHECK_TIMEOUT_MS, HealthController } from './health.controller';

async function createController(queryRaw: jest.Mock) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  // Los fallos de la base se registran con Logger.error: aquí son esperados.
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('GET /health', () => {
    it('responde ok sin consultar la base', async () => {
      const queryRaw = jest.fn();
      const controller = await createController(queryRaw);

      expect(controller.check()).toEqual({ status: 'ok' });
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/ready', () => {
    it('responde ok cuando la base responde', async () => {
      const controller = await createController(
        jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      );

      await expect(controller.ready()).resolves.toEqual({
        status: 'ok',
        database: 'ok',
      });
    });

    it('responde 503 cuando la base falla', async () => {
      const controller = await createController(
        jest.fn().mockRejectedValue(new Error('connection refused')),
      );

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('responde 503 si la base no contesta a tiempo', async () => {
      jest.useFakeTimers();
      const controller = await createController(
        jest.fn(() => new Promise(() => undefined)),
      );

      const result = controller.ready();
      jest.advanceTimersByTime(DB_CHECK_TIMEOUT_MS);

      await expect(result).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
