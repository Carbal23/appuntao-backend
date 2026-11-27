import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadTestEnv } from './test-env';

/**
 * Corre una vez antes de todas las pruebas con base real: crea
 * `appuntao_test` si no existe y le aplica las migraciones pendientes, las
 * mismas que se aplican en development y production.
 */
export default async function globalSetup(): Promise<void> {
  const db = loadTestEnv();

  const admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
  try {
    const rows = await admin.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${db.name}) AS found`;
    if (!rows[0]?.found) {
      // El nombre ya se validó en loadTestEnv (solo [a-z0-9_]).
      await admin.$executeRawUnsafe(`CREATE DATABASE "${db.name}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  try {
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: db.url, DIRECT_URL: db.url },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = (error as { stdout?: Buffer; stderr?: Buffer }) ?? {};
    throw new Error(
      `No se pudieron aplicar las migraciones en ${db.name}:\n${String(output.stdout ?? '')}${String(output.stderr ?? '')}`,
    );
  }
}
