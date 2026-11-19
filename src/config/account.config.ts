import { registerAs } from '@nestjs/config';

export default registerAs('account', () => ({
  // Días entre la solicitud de eliminación y la anonimización. Dentro de
  // este plazo el usuario puede cancelarla iniciando sesión. Debe caber en
  // los 15 días hábiles que da la Ley 1581 para atender el reclamo.
  deletionGraceDays: parseInt(
    process.env.ACCOUNT_DELETION_GRACE_DAYS || '15',
    10,
  ),
  // Meses que se conserva una cuenta desactivada antes de anonimizarla.
  inactiveRetentionMonths: parseInt(
    process.env.INACTIVE_ACCOUNT_RETENTION_MONTHS || '48',
    10,
  ),
  // Meses que se conservan los datos de un negocio cerrado o inactivo antes
  // de eliminarlos. Durante ese tiempo el dueño puede descargarlos.
  closedBusinessRetentionMonths: parseInt(
    process.env.CLOSED_BUSINESS_RETENTION_MONTHS || '6',
    10,
  ),
}));
