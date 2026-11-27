import path from 'node:path';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';

/** Nombre de la base de pruebas por defecto, en el mismo Postgres local. */
export const TEST_DB_NAME = 'appuntao_test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type TestDatabase = {
  /** URL de la base de pruebas. */
  url: string;
  /** Nombre de la base (siempre termina en `_test`). */
  name: string;
  /** URL de la base `postgres` del mismo servidor, para crear la de pruebas. */
  adminUrl: string;
};

/**
 * Prepara las variables de entorno de las pruebas con base real.
 *
 * Toma el usuario, la clave, el host y el puerto de `.env.local` y cambia
 * solo el nombre de la base por `appuntao_test`. Para usar otra base se
 * define `TEST_DATABASE_URL`.
 *
 * Dos barreras para no borrar nunca una base de verdad (cada archivo de
 * pruebas vacía todas las tablas):
 * - el nombre de la base tiene que terminar en `_test`;
 * - sin `TEST_DATABASE_URL`, el servidor tiene que ser local.
 */
export function loadTestEnv(): TestDatabase {
  const explicit = process.env.TEST_DATABASE_URL;

  if (!explicit) {
    // `override`: una DATABASE_URL que venga de la terminal (por ejemplo la
    // de development) no se usa nunca.
    expand(
      config({
        path: path.resolve(__dirname, '../../.env.local'),
        override: true,
        quiet: true,
      }),
    );
  }

  const source = explicit ?? process.env.DATABASE_URL;
  if (!source) {
    throw new Error(
      'Pruebas con base real: falta .env.local (DATABASE_URL) o TEST_DATABASE_URL',
    );
  }

  const url = new URL(source);
  if (!explicit) {
    if (!LOCAL_HOSTS.has(url.hostname)) {
      throw new Error(
        `Pruebas con base real: .env.local apunta a ${url.hostname}, no a un Postgres local. Usa TEST_DATABASE_URL.`,
      );
    }
    url.pathname = `/${TEST_DB_NAME}`;
  }

  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Pruebas con base real: la base "${name}" no termina en _test. No se usa para no borrar datos reales.`,
    );
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';

  process.env.DATABASE_URL = url.toString();
  process.env.DIRECT_URL = url.toString();
  process.env.NODE_ENV = 'test';
  // Las pruebas no mandan correos ni esperan códigos.
  process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
  process.env.RESEND_API_KEY = 're_test';

  return { url: url.toString(), name, adminUrl: admin.toString() };
}
