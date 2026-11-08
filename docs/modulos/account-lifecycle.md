# Módulo `account-lifecycle`

**Código:** `src/account-lifecycle/` · **Ejecución manual:** `src/maintenance.ts`

> **Documento parcial:** contenido trasladado del README. Falta completarlo con la plantilla (endpoints de transferencia y exportación, reglas de anonimización, errores, decisiones).

## Propósito

Gestiona el ciclo de vida de las cuentas y de la propiedad de los negocios:

- el usuario puede **desactivar** su cuenta (reversible) o **pedir su eliminación** (15 días de gracia y luego anonimización);
- un administrador puede desactivar y reactivar cuentas;
- un dueño puede **transferir** su negocio a un miembro, que debe aceptarlo, y **descargar en Excel** la información de su negocio;
- una tarea diaria aplica los plazos de retención.

Las rutas de cuenta se exponen desde [`users`](users.md#endpoints); la reactivación desde el login está en [`auth`](auth.md#login).

## Estados de la cuenta

| Estado | Cómo se llega | Cómo se sale |
| --- | --- | --- |
| Activa | — | — |
| Desactivada por el usuario (`ACCOUNT_DEACTIVATED`) | `POST /api/users/me/deactivate` | Login con `reactivate: true` |
| Eliminación pendiente (`ACCOUNT_DELETION_PENDING`) | `POST /api/users/me/deletion` | Login con `reactivate: true` antes de que venza el plazo |
| Desactivada por un administrador (`ACCOUNT_DISABLED`) | `PATCH /api/users/:id/inactivate` | `PATCH /api/users/:id/reactivate` (solo `ADMIN`) |
| Anonimizada | Vence la eliminación o la retención de inactividad | Definitivo: la cuenta no se recupera |

Campos de `User`: `inactivatedAt`, `inactivatedBy` (`SELF` o `ADMIN`), `deletionRequestedAt`, `deletionScheduledAt`, `anonymizedAt`.

Desactivar la cuenta cierra todas sus sesiones. Si el usuario es dueño de negocios activos, para pedir la eliminación debe enviar `acknowledgeBusinessClosure: true`; `GET /api/users/me/deletion-preview` muestra antes qué negocios se cerrarían, con sus clientes, saldo por cobrar y candidatos a recibir la transferencia.

## Tarea diaria

`AccountMaintenanceService` corre **todos los días a las 3:00 a. m. (hora Colombia)** y:

1. anonimiza las cuentas cuya eliminación venció;
2. anonimiza las cuentas desactivadas hace más de `INACTIVE_ACCOUNT_RETENTION_MONTHS`;
3. marca como vencidas las transferencias de negocio sin respuesta (7 días);
4. elimina los datos de los negocios inactivos hace más de `CLOSED_BUSINESS_RETENTION_MONTHS`.

| Variable (opcional) | Por defecto |
| --- | --- |
| `ACCOUNT_DELETION_GRACE_DAYS` | 15 |
| `INACTIVE_ACCOUNT_RETENTION_MONTHS` | 48 |
| `CLOSED_BUSINESS_RETENTION_MONTHS` | 6 |

Para ejecutarla a mano (por ejemplo, si el servidor estuvo caído a esa hora):

```bash
npm run build
npm run maintenance:run:local   # o :development / :production
```

> ⚠️ **Primer despliegue en un entorno:** la primera ejecución actúa de inmediato sobre todo lo que ya cumpla los plazos (negocios inactivos hace más de 6 meses, cuentas inactivas hace más de 48). Antes de desplegar, revisa cuántos registros hay en esa situación.

La tarea corre en cada instancia del servidor; es segura con varias instancias, porque cada cuenta y cada negocio se procesa una sola vez.

## Modelos

| Modelo | Uso |
| --- | --- |
| `User` | Estados de la cuenta |
| `BusinessOwnershipTransfer` | Transferencias de propiedad: de quién, a quién, estado y vencimiento |
| `UserConsent` | Se marca `revokedAt` al eliminar la cuenta |
