# Módulo `audit`

**Código:** `src/audit/` (`audit.service.ts`, `audit.types.ts`)

> **Estado:** revisado en `feature/audit-review` el 2026-11-22 junto con [auth-log](auth-log.md), y probado por script con 25 casos (ver [Qué se verificó](#qué-se-verificó)). Trae la migración `20261122200000_audit_indexes_password_events`.

## Propósito

El **historial de quién hizo qué** en los negocios: quién fió, abonó, descontó, reversó o anuló cada peso, quién registró o editó a cada cliente, quién entró o salió del equipo y con qué rol. Sirve para resolver un reclamo ("yo no fié eso"), revisar lo que hizo un empleado y probar lo que pasó con un negocio.

No tiene endpoints. Los demás módulos llaman a `AuditService.log()`. Para consultarlo hoy hay que ir a la base (ver [Decisiones y pendientes](#decisiones-y-pendientes)).

## Alcance

**Hace:**
- Guardar cada acción con quién la hizo, sobre qué y los datos del cambio.
- Escribirse dentro de la transacción de la operación cuando se lo piden, para que la operación y su registro queden juntos o no quede ninguno.

**No hace:**
- Eventos de seguridad (logins, contraseñas, sesiones): eso es [auth-log](auth-log.md).
- Borrarse solo: se borra con el negocio al que pertenece, cuando se purga (ver [Retención](#retención)).

## Modelo `AuditLog`

| Campo | Qué es |
| --- | --- |
| `userId` | Quién lo hizo. Vacío en lo que hace el sistema, como la purga. No es una relación: el registro se conserva aunque la cuenta se anonimice |
| `action` | Qué pasó (tabla de abajo) |
| `entity` / `entityId` | Sobre qué: `Debt`, `Payment`, `Debtor`, `Business`, `BusinessUser`, `Invitation` y su id |
| `meta` | Los datos del cambio, en JSON. Nunca contraseñas ni tokens |
| `createdAt` | Cuándo |

Índices: `entityId` (la purga de un negocio borra por ahí) y `(userId, createdAt)` (lo que hizo una persona, en orden).

## Cómo se escribe

```ts
await this.auditService.log({ userId, action, entity, entityId, meta }, tx);
```

- **Con `tx`** se escribe en la misma transacción: si falla, la operación se revierte. Es lo que usan la plata, los accesos y los permisos.
- **Sin `tx`** es de mejor esfuerzo: va después de la operación, y si falla queda en el log del servidor y la operación sigue.

Solo tres registros quedan sin `tx`, a propósito:
- crear y reenviar una invitación, que se registran después de enviar el correo para guardar si salió;
- la descarga del Excel, que no cambia nada.

## Qué se audita

| Acción | Módulo | Cuándo | `meta` principal |
| --- | --- | --- | --- |
| `DEBT_CREATED` | debts | Fiar | `amount`, `debtorId`, `businessId`, `dueDate` |
| `DEBT_CANCELLED` | debts | Anular una deuda | `previousStatus`, `newStatus`, `amount`, `balance`, `debtorId` |
| `DEBT_STATUS_CHANGED` | payments | Cada recálculo del saldo | `previousBalance`, `newBalance`, `previousStatus`, `status`, `causeId` (el movimiento que lo causó) |
| `PAYMENT_CREATED` | payments | Abono (sobre el `Payment`) o pago global (uno solo, sobre el `PaymentGroup`) | monto, deuda y cliente; en el global, total, cuántos pagos y qué deudas |
| `PAYMENT_DISCOUNT` | payments | Descuento | monto y motivo |
| `PAYMENT_REVERSAL` | payments | Reverso de un abono o descuento (sobre el reverso) o de un pago global (sobre el grupo) | el movimiento reversado, su tipo, monto y motivo; en el global, cuántos y el total |
| `DEBTOR_CREATED` | debtors | Registrar un cliente | `name`, `documentNumber`, `phone` |
| `DEBTOR_UPDATED` | debtors | Editarlo | nombre, documento y celular antes y después |
| `DEBTOR_INACTIVATED` | debtors | Quitarlo de la lista | `previousUserId`, invitaciones canceladas |
| `DEBTOR_UNLINKED` | debtors | Desvincular la ficha de la cuenta | `previousUserId`, `by`: `BUSINESS` o `CLIENT` |
| `INVITATION_CREATED` / `_RESENT` | invitations | Crear o reenviar | tipo, rol, por correo o celular, si salió el correo |
| `INVITATION_ACCEPTED` | invitations | Aceptarla | tipo, rol, la ficha vinculada (`debtorId`): es la prueba de que el cliente aceptó que lo vean |
| `INVITATION_REJECTED` / `_CANCELLED` | invitations | Rechazarla o cancelarla | tipo |
| `BUSINESS_USER_ADDED` | invitations | Entrar al equipo aceptando una invitación | `userId`, `role`, `invitationId`, `invitedById` |
| `BUSINESS_USER_ROLE_UPDATED` | business-user | Cambio de rol | `previousRole`, `newRole` |
| `BUSINESS_USER_REMOVED` / `_LEFT` | business-user | Lo sacaron / se salió | `role` |
| `BUSINESS_CREATED` / `_UPDATED` | business | Crear / editar | nombre y dirección (en la edición, solo lo que cambió, antes y después) |
| `BUSINESS_DEACTIVATED` / `_REACTIVATED` | business | Cerrar / reabrir | — / cuándo se había cerrado |
| `BUSINESS_OWNERSHIP_TRANSFER_REQUESTED` / `_CANCELLED` / `_REJECTED` | business | La propuesta de transferencia | `transferId`, `toUserId` |
| `BUSINESS_OWNERSHIP_TRANSFERRED` | business | Se aceptó | dueño anterior y nuevo |
| `BUSINESS_DATA_EXPORTED` | business, account-lifecycle | Cada descarga del Excel | — |
| `BUSINESS_PURGED` | account-lifecycle | Se borraron los datos de un negocio cerrado | — |

Cada módulo explica sus registros con más detalle en su documento.

## Retención

**La auditoría vive mientras exista el negocio.** Es el respaldo de las cuentas: borrarla antes dejaría deudas sin historial.

Cuando la tarea diaria purga un negocio cerrado, se borra su auditoría junto con sus clientes, deudas y pagos, porque guarda datos de los clientes (nombre, documento, celular). Solo quedan `BUSINESS_DATA_EXPORTED` y `BUSINESS_PURGED`, que prueban que el dueño recibió sus datos y que la eliminación se hizo. Ver [account-lifecycle](account-lifecycle.md#tarea-diaria).

## Revisión del 2026-11-22

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | `AuditLog` no tenía índices: la purga de un negocio, que borra por `entityId`, recorría la tabla completa | Índices por `entityId` y por `(userId, createdAt)` |
| 2 | Aceptar una invitación, desvincular un cliente, quitarlo de la lista, rechazar o cancelar una invitación o una transferencia, y crear o editar un cliente se auditaban fuera de la transacción: si la auditoría fallaba, el cambio quedaba sin rastro | Dentro de la transacción |
| 3 | `BUSINESS_USER_ADDED` existía pero nunca se escribía: la entrada al equipo solo quedaba como `INVITATION_ACCEPTED` | Se escribe al aceptar una invitación de equipo, con el rol y quién invitó |
| 4 | `DEBT_UPDATED` existía pero no se usaba (las deudas no se editan) | Quitado |
| 5 | Un fallo sin `tx` se escribía con `console.error`, y `meta` era `any` | `Logger` de Nest, y `meta` con el tipo JSON de Prisma |

En development había 54 registros, de 7 acciones distintas.

## Qué se verificó

Script contra una base desechable con todas las migraciones (los casos de auditoría de los 25 de [auth-log](auth-log.md#qué-se-verificó)):
- los dos índices existen;
- crear y editar un cliente dejan `DEBTOR_CREATED` y `DEBTOR_UPDATED`, este con el nombre anterior;
- el cliente acepta la invitación (`INVITATION_ACCEPTED`) y se desvincula (`DEBTOR_UNLINKED` con `by: CLIENT`);
- un empleado acepta una invitación: `BUSINESS_USER_ADDED` con su rol y quién lo invitó;
- rechazar y cancelar invitaciones dejan su registro;
- quitar un cliente deja `DEBTOR_INACTIVATED`;
- rechazar y cancelar una transferencia dejan su registro.

Las suites de debtors (53), debts (48), payments (55), business-user (36) y business (44) siguen pasando.

## Decisiones y pendientes

- **Decisión (2026-11-22):** la auditoría vive con el negocio, sin un plazo propio.
- **Pendiente:** no hay forma de consultarla sin entrar a la base. Para el MVP alcanza. Más adelante podría haber un "historial" por cliente o por deuda en la app, solo para el dueño.
