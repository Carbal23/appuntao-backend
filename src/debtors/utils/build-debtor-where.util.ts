import { DebtStatus, Prisma } from '@prisma/client';
import { buildWhere } from 'src/common/pagination/utils/build-where.util';

/**
 * Los teléfonos y los documentos se guardan solo con dígitos. Si la búsqueda
 * parece un número escrito con espacios, guiones o el indicativo ("+57 300
 * 123"), se busca también sin ellos; si no, "300 123" no encontraba nada.
 */
const digitsVariant = (search: string): string | undefined => {
  if (!/^[\d\s+().-]+$/.test(search)) return undefined;
  let digits = search.replace(/\D/g, '');
  if (search.trim().startsWith('+57')) digits = digits.slice(2);
  return digits && digits !== search ? digits : undefined;
};

export const buildDebtorWhere = (
  base: Prisma.DebtorWhereInput,
  search?: string,
  hasDebt?: boolean,
): Prisma.DebtorWhereInput => {
  const term = search?.trim() || undefined;
  const where = buildWhere({
    filters: {
      ...base,
      inactivatedAt: null,
    },
    search: term,
    searchFields: ['name', 'phone', 'documentNumber'],
  }) as Prisma.DebtorWhereInput;

  const digits = term ? digitsVariant(term) : undefined;
  if (digits && Array.isArray(where.OR)) {
    where.OR.push(
      { phone: { contains: digits } },
      { documentNumber: { contains: digits } },
    );
  }

  if (hasDebt !== undefined) {
    const withBalance = {
      some: {
        status: {
          in: [DebtStatus.OPEN, DebtStatus.PARTIAL],
        },
        balance: {
          gt: 0,
        },
      },
    };

    where.debts = hasDebt ? withBalance : { none: withBalance.some };
  }

  return where;
};
