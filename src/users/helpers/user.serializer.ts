import { User } from '@prisma/client';
import { UserSafe, userSafeSelect } from '../user.select';

/** Deja solo los campos públicos del usuario (sin contraseña ni estados internos). */
export function serializeUser(user: User): UserSafe {
  const keys = Object.keys(userSafeSelect) as (keyof UserSafe)[];
  return Object.fromEntries(keys.map((key) => [key, user[key]])) as UserSafe;
}
