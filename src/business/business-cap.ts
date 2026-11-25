import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Negocios activos que puede tener una persona como dueña. Alcanza de sobra
 * para una tienda real y frena la creación masiva desde una sola cuenta. Los
 * cerrados no cuentan.
 */
export const MAX_ACTIVE_OWNED_BUSINESSES = 10;

/**
 * Exige que el usuario pueda quedar como dueño de un negocio activo más. Es
 * la misma regla al crear, al reabrir y al aceptar una transferencia.
 *
 * Bloquea la fila del usuario (`FOR UPDATE`): dos operaciones a la vez sobre
 * la misma persona se aplican una detrás de la otra y no se saltan el tope.
 * Va dentro de la transacción que crea, reabre o transfiere el negocio.
 */
export async function assertCanOwnAnotherBusiness(
  tx: Prisma.TransactionClient,
  userId: string,
  message = `Ya tienes ${MAX_ACTIVE_OWNED_BUSINESSES} negocios activos, el máximo. Cierra uno para abrir otro.`,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const active = await tx.business.count({
    where: { ownerId: userId, inactivatedAt: null },
  });
  if (active >= MAX_ACTIVE_OWNED_BUSINESSES) {
    throw new BadRequestException(message);
  }
}
