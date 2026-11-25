import { createHmac, randomInt, timingSafeEqual } from 'crypto';

/**
 * Códigos de 6 dígitos que llegan al correo: recuperar la contraseña y
 * verificar el correo. Ver docs/modulos/auth.md.
 *
 * El código nunca se guarda en claro: se guarda su HMAC con una clave
 * derivada de `JWT_SECRET` y del propósito. Así una copia de la base no
 * basta para probar los 10^6 códigos posibles, y un código de un propósito
 * no sirve para el otro.
 */

/** Un código de 6 dígitos, con ceros a la izquierda. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface CodeHasher {
  hash(code: string): string;
  /** Compara en tiempo constante. */
  matches(code: string, codeHash: string): boolean;
}

/**
 * @param secret `JWT_SECRET`.
 * @param purpose Separa las claves por uso. `'password-reset-code'` es el de
 * la recuperación de contraseña desde antes de este archivo: cambiarlo
 * invalidaría los códigos vigentes.
 */
export function createCodeHasher(secret: string, purpose: string): CodeHasher {
  const key = createHmac('sha256', secret).update(purpose).digest();
  const hash = (code: string) =>
    createHmac('sha256', key).update(code).digest('hex');

  return {
    hash,
    matches(code, codeHash) {
      const expected = Buffer.from(codeHash, 'hex');
      const actual = Buffer.from(hash(code), 'hex');
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    },
  };
}
