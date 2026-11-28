import { BusinessUserRole, DebtStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Datos mínimos para las pruebas con base real, escritos directo con Prisma.
 * Cada función crea una sola cosa y devuelve la fila.
 */

let sequence = 0;
const next = () => ++sequence;

export function createUser(prisma: PrismaService, name = 'Usuario') {
  const n = next();
  return prisma.user.create({
    data: {
      email: `user${n}@test.appuntao`,
      firstName: name,
      lastName: `Prueba ${n}`,
      documentType: 'CC',
      documentNumber: `900${String(n).padStart(7, '0')}`,
      emailVerifiedAt: new Date(),
    },
  });
}

/** Negocio con su dueño ya registrado como miembro `OWNER`. */
export async function createBusiness(
  prisma: PrismaService,
  ownerId: string,
  name = 'Tienda de prueba',
) {
  const business = await prisma.business.create({
    data: { ownerId, name },
  });
  await addMember(prisma, business.id, ownerId, BusinessUserRole.OWNER);
  return business;
}

export function addMember(
  prisma: PrismaService,
  businessId: string,
  userId: string,
  role: BusinessUserRole,
) {
  return prisma.businessUser.create({ data: { businessId, userId, role } });
}

export function createDebtor(
  prisma: PrismaService,
  businessId: string,
  name = 'Cliente',
) {
  return prisma.debtor.create({ data: { businessId, name } });
}

/**
 * Deuda sin movimientos: saldo igual al monto. `createdAt` decide el orden
 * del pago global (de la más antigua a la más nueva).
 */
export function createDebt(
  prisma: PrismaService,
  data: {
    businessId: string;
    debtorId: string;
    createdBy: string;
    amount: number | string;
    createdAt?: Date;
    status?: DebtStatus;
    dueDate?: Date | null;
    description?: string | null;
  },
) {
  const amount = new Prisma.Decimal(data.amount);
  return prisma.debt.create({
    data: {
      businessId: data.businessId,
      debtorId: data.debtorId,
      createdBy: data.createdBy,
      amount,
      balance: amount,
      status: data.status ?? DebtStatus.OPEN,
      createdAt: data.createdAt,
      dueDate: data.dueDate ?? null,
      description: data.description ?? null,
    },
  });
}

/** Saldo y estado actuales de una deuda, con el saldo como texto ("40.00"). */
export async function debtState(prisma: PrismaService, debtId: string) {
  const debt = await prisma.debt.findUniqueOrThrow({
    where: { id: debtId },
    select: { balance: true, status: true },
  });
  return { balance: debt.balance.toFixed(2), status: debt.status };
}
