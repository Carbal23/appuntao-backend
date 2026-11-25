import { BusinessUserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/** El negocio activo de la petición y el rol del usuario en él. */
export interface BusinessMembership {
  businessId: string;
  userId: string;
  /** `false` si el negocio no existe. */
  businessExists: boolean;
  inactivatedAt: Date | null;
  /** `null` si el usuario no es miembro. */
  role: BusinessUserRole | null;
}

export type RequestWithMembership = {
  businessMembership?: BusinessMembership;
};

/**
 * Trae en una sola consulta el negocio y la membresía del usuario, y la deja
 * en la petición.
 *
 * `BusinessContextGuard` y `BusinessRoleGuard` necesitan los mismos datos.
 * Antes cada uno consultaba por su lado: con la consulta del usuario en
 * `JwtStrategy`, eran 4 idas a la base antes de llegar al controller. Ahora
 * son 2: el primer guard consulta y el segundo reutiliza el resultado.
 */
export async function loadBusinessMembership(
  prisma: PrismaService,
  request: RequestWithMembership,
  businessId: string,
  userId: string,
): Promise<BusinessMembership> {
  const cached = request.businessMembership;
  if (cached && cached.businessId === businessId && cached.userId === userId) {
    return cached;
  }

  const [row] = await prisma.$queryRaw<
    { inactivatedAt: Date | null; role: BusinessUserRole | null }[]
  >`
    SELECT b."inactivatedAt", bu.role
    FROM "Business" b
    LEFT JOIN "BusinessUser" bu
      ON bu."businessId" = b.id AND bu."userId" = ${userId}
    WHERE b.id = ${businessId}`;

  const membership: BusinessMembership = {
    businessId,
    userId,
    businessExists: !!row,
    inactivatedAt: row?.inactivatedAt ?? null,
    role: row?.role ?? null,
  };
  request.businessMembership = membership;
  return membership;
}
