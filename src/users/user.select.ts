import { Prisma, User } from '@prisma/client';

export const userSafeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  documentType: true,
  documentNumber: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserSafe = {
  [K in keyof typeof userSafeSelect]: User[K];
};
