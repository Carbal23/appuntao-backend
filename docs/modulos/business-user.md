# Módulo `business-user`

**Código:** `src/business-user/`

> **Estado:** backend revisado en `feature/business-user-review` el 2026-11-22 y probado por script con 36 casos (ver [Qué se verificó](#qué-se-verificó)). No trae migraciones. La app se ajustó en su rama `feature/business-user-review` y se probó en el teléfono. Entregado en development (merge `3ca2787` en `develop`).

## Propósito

El **equipo de un negocio**: quién trabaja en él y con qué rol. Desde aquí se lista el equipo, se le cambia el rol a alguien, se saca a alguien y uno se sale por su cuenta.

## Alcance

**Hace:**
- Listar el equipo del negocio, con búsqueda y orden.
- Cambiar el rol de un miembro.
- Sacar a un miembro del negocio.
- Salirse del negocio.

**No hace:**
- Sumar gente: se entra aceptando una invitación (`invitations`).
- Cambiar el dueño: eso es la transferencia de la propiedad (`business`).
- Borrar membresías al eliminar una cuenta (`account-lifecycle`).

## Modelos

| Modelo | Uso en este módulo |
| --- | --- |
| `BusinessUser` | La membresía: negocio, usuario y rol. Un usuario tiene una sola por negocio (`@@unique([businessId, userId])`) |
| `Business` | `ownerId` dice quién es el dueño. Se bloquea la fila mientras se cambia el equipo |
| `BusinessOwnershipTransfer` | Si alguien sale del equipo con una transferencia por responder, se cancela |
| `AuditLog` | Cambio de rol, salida y retiro, dentro de la misma transacción |

## Roles

| Rol | En la app | Qué hace en el negocio |
| --- | --- | --- |
| `OWNER` | Dueño | Todo. Hay uno solo y coincide con `Business.ownerId` |
| `ADMIN` | Administrador | Todo lo del día a día, más corregir (anular, descontar, reversar) y manejar cajeros y solo lectura |
| `CASHIER` | Cajero | Fía, cobra y atiende clientes |
| `VIEWER` | Solo lectura | Consulta; no registra ni modifica nada |

### Quién maneja a quién

"Manejar" un rol es invitar con ese rol, pasar a alguien a ese rol, cambiarle el rol a quien lo tiene y sacarlo del negocio. La regla está en un solo lugar, `src/business-user/team-rules.ts`, y la usan este módulo e `invitations`.

| Quien actúa | Maneja |
| --- | --- |
| Dueño | Administrador, cajero, solo lectura |
| Administrador | Cajero, solo lectura |
| Cajero, solo lectura | Nadie |

Además:
- `OWNER` no se asigna nunca: el dueño solo cambia por transferencia.
- Nadie cambia su propio rol ni se saca a sí mismo: para irse está "Salir del negocio".
- El dueño no puede salirse: primero transfiere el negocio. Así un negocio nunca queda sin dueño.

## Endpoints

Todos exigen `Authorization: Bearer <token>` y `x-business-id`.

| Método | Ruta | Quién | Qué hace |
| --- | --- | --- | --- |
| `GET` | `/api/business-users?page&limit&search&sortBy&order` | Cualquier rol | Lista el equipo con nombre, correo y teléfono de cada uno. `search` busca en nombre, apellido y correo. `sortBy`: `createdAt` (por defecto) o `role` |
| `PATCH` | `/api/business-users/:id` | Dueño, administrador | Cambia el rol. Body: `{ "role": "ADMIN" \| "CASHIER" \| "VIEWER" }`. Si el rol es el mismo responde 200 sin cambiar ni auditar |
| `DELETE` | `/api/business-users/:id` | Dueño, administrador | Saca al miembro del negocio |
| `DELETE` | `/api/business-users/me` | Cualquier rol menos el dueño | Salirse del negocio |

`:id` es el id de la membresía (`BusinessUser.id`), no el del usuario.

### Errores

| Código | Cuándo |
| --- | --- |
| 400 | `role` inválido u `OWNER`; `sortBy` u `order` inválidos; el dueño intenta salirse |
| 403 | Cajero o solo lectura intentan cambiar o sacar; quien actúa no maneja el rol del miembro o el rol pedido; tocar al dueño; cambiar el propio rol o sacarse a sí mismo |
| 404 | La membresía no existe **o es de otro negocio** |

## Reglas de negocio

1. **Todo se busca dentro del negocio del header.** Una membresía de otro negocio responde 404, igual que una que no existe.
2. **Al sacar a alguien pierde el acceso en la siguiente petición.** Los guards (`BusinessContextGuard`, `BusinessRoleGuard`) consultan la membresía en la base en cada petición; el token no guarda roles.
3. **Al salir del equipo se cancela su transferencia pendiente**, si el dueño le había propuesto el negocio.
4. **Cambiar el equipo bloquea la fila del negocio** (`SELECT … FOR UPDATE`). Una transferencia de la propiedad o dos cambios simultáneos se aplican uno detrás del otro, así que el dueño y los roles que se validan no cambian a mitad de camino.
5. **La auditoría va en la misma transacción.** Si no se puede escribir, el cambio no se aplica.

### Auditoría

| Acción | Cuándo | `meta` |
| --- | --- | --- |
| `BUSINESS_USER_ROLE_UPDATED` | Cambio de rol | `userId`, `businessId`, `previousRole`, `newRole` |
| `BUSINESS_USER_REMOVED` | Lo sacaron | `userId`, `businessId`, `role` |
| `BUSINESS_USER_LEFT` | Se salió | `userId`, `businessId`, `role` |
| `BUSINESS_USER_ADDED` | Entró por invitación (lo escribe `invitations`, dentro de la transacción) | `userId`, `businessId`, `role`, `invitationId`, `invitedById` |

En los registros anteriores a esta revisión la clave del rol anterior está escrita `previusRole`.

## Revisión del 2026-11-22

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | **Grave.** `PATCH` y `DELETE` buscaban la membresía solo por id, sin mirar el negocio. Cualquiera con un negocio propio (donde es dueño) podía, con el id de un miembro de otra tienda (visible en la lista del equipo si trabaja allí), bajarle el rol al dueño de esa tienda, sacarlo del equipo o subir a otro a administrador. El chequeo de "no tocar al dueño" se hacía contra el dueño del negocio propio | Se busca dentro del negocio del header; si no está, 404. Se probó el ataque contra `develop` (funcionaba) y contra el código nuevo (404). En development no había casos: solo hay membresías de dueños |
| 2 | `PATCH` aceptaba `role: OWNER`: se podía crear un segundo dueño sin transferencia | El DTO solo acepta `ADMIN`, `CASHIER` y `VIEWER` |
| 3 | El administrador podía bajar o subir a otros administradores e invitar administradores nuevos | Decisión: el administrador solo maneja cajeros y solo lectura. También en `invitations` (crear, reenviar y cancelar) |
| 4 | Solo el dueño podía sacar a alguien | Decisión: el administrador también, a los que maneja |
| 5 | No había forma de salirse de un negocio: solo si te sacaban o borrabas la cuenta | Nuevo `DELETE /business-users/me`. El dueño no puede |
| 6 | La auditoría se escribía fuera de la transacción y la clave decía `previusRole` | Dentro de la transacción y con `previousRole`. Un cambio al mismo rol ya no se audita |
| 7 | `sortBy` aceptaba cualquier campo; uno inexistente respondía 500 | Solo `createdAt` o `role`; si no, 400. Desempate por `id` para que la paginación sea estable |
| 8 | Las validaciones y el cambio no estaban en la misma transacción | Todo va en una transacción con la fila del negocio bloqueada |

## En la app

- **Pantalla Equipo:**
  - el administrador solo puede tocar a cajeros y "solo lectura"; los administradores y el dueño aparecen, pero no se pueden tocar;
  - el dueño puede tocar a todos menos a sí mismo.
- **Hoja del miembro:** solo ofrece los roles que quien gestiona puede asignar (el administrador no ve "Administrador"). "Quitar del negocio" aparece también para el administrador.
- **Invitar:** el administrador no ve "Administrador" entre los roles.
- **Invitaciones pendientes de administrador:** el administrador las ve, pero no las puede reenviar ni cancelar.
- **"Salir del negocio":** botón al final de la pantalla Equipo para quien no es el dueño. Pide confirmación; al salir, la app pasa al siguiente negocio que tenga.
- **Permisos:** la regla está calcada en `manageableRoles` y `canManageRole` de `src/domain/permissions.ts`.

## Qué se verificó

Script contra una base desechable con todas las migraciones (36 casos, todos OK; contra `develop` fallan 27):
- **Entre negocios:** el dueño de otro negocio no cambia el rol del dueño, no lo saca ni sube a un cajero (404).
- **Cambiar rol:**
  - `OWNER` responde 400;
  - el cajero recibe 403;
  - el administrador no nombra administradores ni toca a otro administrador;
  - nadie toca al dueño ni cambia su propio rol;
  - el administrador pasa un cajero a solo lectura y queda auditado con `previousRole`;
  - repetir el mismo rol no se audita;
  - el dueño nombra y baja administradores;
  - un id inexistente responde 404.
- **Sacar:**
  - el cajero no puede;
  - el administrador no saca a otro administrador, pero sí a uno de solo lectura;
  - el que sacaron pierde el acceso en la siguiente petición;
  - el dueño no se saca;
  - queda auditado.
- **Salir:**
  - un miembro se sale y su transferencia pendiente se cancela;
  - queda auditado `BUSINESS_USER_LEFT`;
  - el dueño recibe 400;
  - salirse otra vez responde 403.
- **Listado:** `sortBy` inventado responde 400; se ordena por rol y se busca por nombre.
- **Invitaciones:** el administrador no invita administradores ni reenvía o cancela una invitación de administrador; sí invita cajeros. El dueño invita administradores.
