import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthModule } from 'src/health/health.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { configureApp } from 'src/app.setup';

/**
 * Prueba por HTTP, con la misma configuración que `main.ts` (`configureApp`). La base se
 * reemplaza: los e2e contra una base real necesitan una base de pruebas
 * propia (ver docs/pruebas.md).
 */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    // El 503 registra un error: aquí es esperado.
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health responde 200', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GET /api/health/ready responde 200 con la base arriba', () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    return request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect({ status: 'ok', database: 'ok' });
  });

  it('GET /api/health/ready responde 503 con la base caída', () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    return request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503)
      .expect({ status: 'error', database: 'unavailable' });
  });
});
