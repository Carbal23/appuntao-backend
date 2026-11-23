import { BusinessUserRole } from '@prisma/client';

/**
 * Qué roles maneja cada rol del equipo: invitar con ese rol, pasar a alguien
 * a ese rol, cambiarle el rol a quien lo tiene y sacarlo del negocio.
 *
 * - El dueño maneja a todos menos a sí mismo.
 * - El administrador solo a cajeros y "solo lectura": no nombra ni toca a
 *   otros administradores.
 * - Nadie asigna OWNER: el dueño solo cambia por transferencia.
 */
const MANAGEABLE: Record<BusinessUserRole, readonly BusinessUserRole[]> = {
  [BusinessUserRole.OWNER]: [
    BusinessUserRole.ADMIN,
    BusinessUserRole.CASHIER,
    BusinessUserRole.VIEWER,
  ],
  [BusinessUserRole.ADMIN]: [BusinessUserRole.CASHIER, BusinessUserRole.VIEWER],
  [BusinessUserRole.CASHIER]: [],
  [BusinessUserRole.VIEWER]: [],
};

export const canManageRole = (
  actor: BusinessUserRole | null | undefined,
  target: BusinessUserRole,
): boolean => (actor ? MANAGEABLE[actor].includes(target) : false);
