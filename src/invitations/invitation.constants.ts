import { BusinessUserRole } from '@prisma/client';

/** Roles con los que se puede invitar a un empleado. La propiedad solo cambia por transferencia. */
export const INVITABLE_ROLES = [
  BusinessUserRole.ADMIN,
  BusinessUserRole.CASHIER,
  BusinessUserRole.VIEWER,
] as const;

export const ROLE_LABELS: Record<BusinessUserRole, string> = {
  OWNER: 'Dueño',
  ADMIN: 'Administrador',
  CASHIER: 'Cajero',
  VIEWER: 'Solo lectura',
};

export const DEFAULT_EXPIRATION_DAYS = 7;
export const MAX_EXPIRATION_DAYS = 30;

/**
 * Código de 10 caracteres sin letras ni números que se confunden al leerlos
 * o dictarlos (0/O, 1/I/L). 31 símbolos ^ 10 ≈ 8 × 10^14 combinaciones: no se
 * puede adivinar probando, y además aceptar tiene límite de intentos.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;
