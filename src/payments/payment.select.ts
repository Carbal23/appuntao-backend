export const paymentSelect = {
  id: true,
  amount: true,
  method: true,
  type: true,
  note: true,
  paymentDate: true,
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
