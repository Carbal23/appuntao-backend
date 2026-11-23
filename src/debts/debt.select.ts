export const paymentSelect = {
  id: true,
  amount: true,
  paymentDate: true,
  method: true,
  type: true,
  note: true,
  createdAt: true,
  // Para saber si es parte de un pago global, qué movimiento reversa y si ya
  // fue reversado (y así ofrecer o no "Reversar").
  paymentGroupId: true,
  reversedPaymentId: true,
  reversal: { select: { id: true, createdAt: true } },
  createdByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
};

export const debtSelect = {
  id: true,
  amount: true,
  balance: true,
  currency: true,
  description: true,
  status: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  business: {
    select: {
      id: true,
      name: true,
      currency: true,
    },
  },
  debtor: {
    select: {
      id: true,
      name: true,
      phone: true,
    },
  },
  createdByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  payments: {
    select: paymentSelect,
    orderBy: { paymentDate: 'desc' as const },
  },
};
