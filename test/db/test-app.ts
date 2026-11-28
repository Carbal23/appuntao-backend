import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { PrismaService } from 'src/prisma/prisma.service';

export type TestApp = {
  app: INestApplication<App>;
  prisma: PrismaService;
  /** Token de acceso válido para el usuario, como el que da el login. */
  tokenFor: (user: { id: string; role?: string }) => Promise<string>;
  close: () => Promise<void>;
};

/**
 * La aplicación completa (`AppModule`), con la configuración de `main.ts` y
 * conectada a la base de pruebas. No se reemplaza nada: guards, DTOs,
 * services y SQL son los reales.
 */
export async function createTestApp(): Promise<TestApp> {
  // PrismaService anuncia la conexión con console.log.
  jest.spyOn(console, 'log').mockImplementation();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService, { strict: false });

  return {
    app,
    prisma,
    tokenFor: (user) =>
      jwt.signAsync({ sub: user.id, role: user.role ?? 'USER' }),
    close: () => app.close(),
  };
}

/**
 * Vacía todas las tablas menos la de migraciones. Se llama antes de cada
 * prueba: cada una arma sus propios datos.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

/** Petición autenticada dentro de un negocio (header `x-business-id`). */
export function asMember(
  app: INestApplication<App>,
  token: string,
  businessId: string,
) {
  const server = app.getHttpServer();
  const auth = (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('x-business-id', businessId);
  return {
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string, body: object = {}) =>
      auth(request(server).post(url)).send(body),
    patch: (url: string, body: object = {}) =>
      auth(request(server).patch(url)).send(body),
  };
}
