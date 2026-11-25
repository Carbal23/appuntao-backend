# Módulo `auth-log`

**Código:** `src/auth-log/` (`auth-log.service.ts`, `auth-log.types.ts`)

> **Estado:** revisado en `feature/audit-review` el 2026-11-22 junto con [audit](audit.md), y probado por script con 25 casos (ver [Qué se verificó](#qué-se-verificó)). Trae la migración `20261122200000_audit_indexes_password_events`.

## Propósito

El **registro de seguridad** de las cuentas: logins, bloqueos, cierres de sesión, contraseñas y cambios de estado de la cuenta. Sirve para investigar un acceso indebido ("alguien entró desde otro teléfono"), ver si alguien está probando contraseñas y probar lo que pasó con una cuenta.

No tiene endpoints. Lo usan `auth`, `users`, `account-lifecycle`, `business` y los guards de límite de intentos.

## Alcance

**Hace:**
- Guardar cada evento con la cuenta, qué se escribió al entrar, el motivo, la IP, el navegador o la app y el dispositivo.
- Borrar los eventos de más de 12 meses, en la tarea diaria.

**No hace:**
- Auditar lo que pasa en los negocios: eso es [audit](audit.md).
- Bloquear: los límites los aplican los guards ([arquitectura](../arquitectura.md#autenticación-y-autorización)). Este módulo solo registra.

## Modelo `AuthLog`

| Campo | Qué es |
| --- | --- |
| `userId` | La cuenta, si se sabe. Vacío en un login con un identificador que no existe. Relación con `User` (`onDelete: SetNull`) |
| `event` | Qué pasó (enum `AuthLogEvent`, tabla de abajo) |
| `identifier` | Lo que se escribió al entrar, normalizado. Ver [Qué se guarda del identificador](#qué-se-guarda-del-identificador) |
| `reason` | El detalle (`AuthLogReason`): por qué falló o qué se estaba confirmando |
| `ipAddress`, `userAgent` | De dónde vino. Detrás de Render necesita `TRUST_PROXY=1` para ver la IP real |
| `deviceId`, `deviceName` | El dispositivo de la sesión ([auth](auth.md)) |
| `deviceInfo` | No se usa |
| `createdAt` | Cuándo |

Índices: `(userId, createdAt)` y `createdAt` (para la retención).

## Cómo se escribe

```ts
await this.authLog.record({ event, userId, identifier, reason, deviceId, deviceName, context });
```

Es de **mejor esfuerzo**: si no se puede escribir, queda en el log del servidor y la petición sigue. Un fallo del registro no debe impedir entrar ni cerrar sesión.

## Eventos

| Evento | Lo escribe | Cuándo | `reason` |
| --- | --- | --- | --- |
| `LOGIN_SUCCESS` | auth | Login correcto | — |
| `LOGIN_FAILED` | auth | Login fallido | `INVALID_CREDENTIALS`, `AMBIGUOUS_IDENTIFIER`, la cuenta no está activa (`ACCOUNT_DISABLED`, `ACCOUNT_DEACTIVATED`, `ACCOUNT_DELETION_PENDING`) o el correo no está verificado (`EMAIL_NOT_VERIFIED`) |
| `LOGIN_BLOCKED` | `LoginThrottlerGuard` | Se superó el límite de login (uno por bloqueo) | — |
| `LOGOUT` / `LOGOUT_ALL_DEVICES` | auth | Cerrar sesión aquí o en todos | — |
| `REFRESH_TOKEN_REUSED` | auth | Se reusó un refresh token ya rotado: posible robo de sesión | — |
| `PASSWORD_CHANGED` / `PASSWORD_CHANGE_FAILED` | users | Cambio de contraseña, o contraseña actual equivocada | — / `WRONG_CURRENT_PASSWORD` |
| `PASSWORD_CONFIRM_FAILED` | account-lifecycle, business | Contraseña equivocada al confirmar una acción | `DEACTIVATE_ACCOUNT`, `DELETE_ACCOUNT`, `TRANSFER_BUSINESS` |
| `PASSWORD_CONFIRM_BLOCKED` | `PasswordConfirmThrottlerGuard` | Más de 5 intentos con contraseña en 15 minutos (uno por bloqueo) | La acción que se intentaba, incluida `CHANGE_PASSWORD` |
| `PASSWORD_RESET_REQUESTED` | auth (`PasswordResetService`) | Se creó y envió un código para recuperar la contraseña | — |
| `PASSWORD_RESET_FAILED` | auth (`PasswordResetService`) | Código de recuperación rechazado | `INVALID_CODE`, `NO_ACTIVE_CODE` (no hay código vigente o el correo no es de una cuenta), `TOO_MANY_ATTEMPTS` |
| `PASSWORD_RESET_BLOCKED` | auth (`PasswordResetService`) | Un código llegó a 5 fallos, o la cuenta a 5 códigos en 24 horas | `TOO_MANY_ATTEMPTS` / `DAILY_LIMIT` |
| `PASSWORD_RESET_COMPLETED` | auth (`PasswordResetService`) | Se cambió la contraseña con un código | — |
| `EMAIL_VERIFICATION_REQUESTED` | email-verification | Se creó y envió un código para verificar el correo | — |
| `EMAIL_VERIFICATION_FAILED` | email-verification | Código de verificación rechazado | `INVALID_CODE`, `NO_ACTIVE_CODE`, `TOO_MANY_ATTEMPTS` |
| `EMAIL_VERIFICATION_BLOCKED` | email-verification | Un código llegó a 5 fallos, o la cuenta a 5 códigos en 24 horas | `TOO_MANY_ATTEMPTS` / `DAILY_LIMIT` |
| `EMAIL_VERIFIED` | email-verification | Se verificó el correo | — |
| `ACCOUNT_DEACTIVATED` / `ACCOUNT_REACTIVATED` | account-lifecycle | Desactivar o reactivar la cuenta | `BY_ADMIN` si fue un administrador |
| `ACCOUNT_DELETION_REQUESTED` / `_CANCELLED` | account-lifecycle | Pedir o cancelar la eliminación | `BUSINESS_CLOSURE_ACKNOWLEDGED` si aceptó cerrar sus negocios |
| `ACCOUNT_ANONYMIZED` | account-lifecycle | Se borraron los datos de la cuenta | `DELETION_REQUESTED` o `INACTIVE_RETENTION_EXPIRED` |

## Qué se guarda del identificador

Lo que se escribió al entrar se normaliza igual que en el límite de intentos: `"300 123 4567"` → `3001234567`, el correo en minúsculas, la cédula sin puntos.

- **Si corresponde a una cuenta,** se guarda: es el correo, el celular o el documento de esa persona.
- **Si no corresponde a ninguna,** solo se guarda si es un correo o solo dígitos (celular, cédula, NIT). Cualquier otra cosa se guarda como `(otro)`.

**Por qué:** quien se equivoca de campo y escribe la contraseña donde va el correo no la deja guardada en texto plano. Un documento de extranjería que no existe también queda como `(otro)`, porque tiene la misma forma que una contraseña: 8 o más letras y números.

## Retención

**Los eventos se borran a los 12 meses** (`AUTH_LOG_RETENTION_MONTHS`), en la tarea diaria de [account-lifecycle](account-lifecycle.md#tarea-diaria). Es el último paso, para que las anonimizaciones de esa misma corrida queden registradas.

Son datos personales (IP, dispositivo, lo que se escribió al entrar), y se conservan también después de eliminar la cuenta: sirven para investigar un acceso indebido. **La Política de Tratamiento de Datos Personales tiene que decir este plazo y para qué se guardan.**

## Revisión del 2026-11-22

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | Los eventos se guardaban para siempre, también los de cuentas eliminadas | Decisión: 12 meses, configurable, borrados en la tarea diaria |
| 2 | Un login fallido guardaba lo que se escribió tal cual: una contraseña escrita en el campo del correo quedaba en texto plano | Solo se guarda si es de una cuenta, un correo o solo dígitos; si no, `(otro)` |
| 3 | Una contraseña equivocada al desactivar, eliminar la cuenta o transferir el negocio no dejaba rastro, y el bloqueo del límite de contraseña tampoco | Decisión: `PASSWORD_CONFIRM_FAILED` y `PASSWORD_CONFIRM_BLOCKED`, con la acción en `reason` |

En development había 47 eventos (21 logins, 14 fallidos, 12 cierres de sesión). El identificador más largo tenía 33 caracteres.

## Qué se verificó

Script contra una base desechable con todas las migraciones (25 casos, todos OK, contando los de [audit](audit.md#qué-se-verificó)):
- **Transferir con contraseña equivocada:** deja `PASSWORD_CONFIRM_FAILED` con `TRANSFER_BUSINESS` y la IP.
- **Desactivar y eliminar:** dejan `DEACTIVATE_ACCOUNT` y `DELETE_ACCOUNT`.
- **Bloqueo:** pasado el límite, tres intentos de cambiar la contraseña responden 429 y dejan **un solo** `PASSWORD_CONFIRM_BLOCKED` (`CHANGE_PASSWORD`).
- **Login fallido:**
  - una contraseña en el campo del correo se guarda como `(otro)`;
  - el correo queda recortado y en minúsculas, y el celular normalizado;
  - el documento de una cuenta que existe se guarda.
- **Retención:** la tarea diaria borra un evento de 400 días, conserva uno de 300 e informa `authLogsDeleted: 1`.

## Decisiones y pendientes

- **Decisión (2026-11-22):** 12 meses de retención. **Por qué:** alcanza para investigar un acceso indebido o un reclamo, y es un plazo fácil de justificar en la política de datos.
- **Pendiente:** poner el plazo en la Política de Tratamiento de Datos Personales.
- **Pendiente:** no hay forma de consultarlo sin entrar a la base. Más adelante, la app podría mostrarle a cada persona su actividad reciente.
