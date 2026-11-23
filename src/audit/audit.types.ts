import { Prisma } from '@prisma/client';

/** Lo que se audita. Ver la tabla completa en docs/modulos/audit.md. */
export enum AuditAction {
  // Debt
  DEBT_CREATED = 'DEBT_CREATED',
  DEBT_STATUS_CHANGED = 'DEBT_STATUS_CHANGED',
  DEBT_CANCELLED = 'DEBT_CANCELLED',

  // Payment
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_DISCOUNT = 'PAYMENT_DISCOUNT',
  PAYMENT_REVERSAL = 'PAYMENT_REVERSAL',

  // Invitation
  INVITATION_CREATED = 'INVITATION_CREATED',
  INVITATION_ACCEPTED = 'INVITATION_ACCEPTED',
  INVITATION_REJECTED = 'INVITATION_REJECTED',
  INVITATION_CANCELLED = 'INVITATION_CANCELLED',
  INVITATION_RESENT = 'INVITATION_RESENT',

  // Business Users
  // Entró al equipo aceptando una invitación.
  BUSINESS_USER_ADDED = 'BUSINESS_USER_ADDED',
  BUSINESS_USER_ROLE_UPDATED = 'BUSINESS_USER_ROLE_UPDATED',
  BUSINESS_USER_REMOVED = 'BUSINESS_USER_REMOVED',
  // El miembro se salió por su cuenta.
  BUSINESS_USER_LEFT = 'BUSINESS_USER_LEFT',

  // Debtor
  DEBTOR_CREATED = 'DEBTOR_CREATED',
  DEBTOR_UPDATED = 'DEBTOR_UPDATED',
  DEBTOR_INACTIVATED = 'DEBTOR_INACTIVATED',
  // La ficha deja de estar ligada a una cuenta. meta.by: BUSINESS o CLIENT.
  DEBTOR_UNLINKED = 'DEBTOR_UNLINKED',

  // Business
  BUSINESS_CREATED = 'BUSINESS_CREATED',
  BUSINESS_UPDATED = 'BUSINESS_UPDATED',
  BUSINESS_DEACTIVATED = 'BUSINESS_DEACTIVATED',
  // El dueño reabrió un negocio cerrado antes de que se eliminaran sus datos.
  BUSINESS_REACTIVATED = 'BUSINESS_REACTIVATED',
  BUSINESS_OWNERSHIP_TRANSFER_REQUESTED = 'BUSINESS_OWNERSHIP_TRANSFER_REQUESTED',
  BUSINESS_OWNERSHIP_TRANSFER_CANCELLED = 'BUSINESS_OWNERSHIP_TRANSFER_CANCELLED',
  BUSINESS_OWNERSHIP_TRANSFER_REJECTED = 'BUSINESS_OWNERSHIP_TRANSFER_REJECTED',
  BUSINESS_OWNERSHIP_TRANSFERRED = 'BUSINESS_OWNERSHIP_TRANSFERRED',
  // Se conservan al purgar un negocio: prueban que el dueño recibió sus datos
  // y que la eliminación se hizo.
  BUSINESS_DATA_EXPORTED = 'BUSINESS_DATA_EXPORTED',
  BUSINESS_PURGED = 'BUSINESS_PURGED',
}

export interface LogParams {
  /** Quién lo hizo. Vacío en lo que hace el sistema (la purga). */
  userId?: string;
  action: AuditAction;
  /** Modelo sobre el que se actuó: 'Debt', 'Payment', 'Business'… */
  entity: string;
  entityId?: string;
  /** Los datos del cambio. Sin contraseñas ni tokens. */
  meta?: Prisma.InputJsonValue;
}
