# Módulo `business`

**Código:** `src/business/` (`business.*`, `business-ownership.*`, `business-export.service.ts`)

> **Estado:** revisado en `feature/business-review` el 2026-11-22. El backend se probó por script con 44 casos (ver [Qué se verificó](#qué-se-verificó)). No trae migraciones. La app se ajustó en su rama `feature/business-review`; falta probarla en el teléfono.

## Propósito

El **negocio**: la tienda en la que se fía. Todo lo demás (clientes, deudas, pagos, equipo) cuelga de un negocio. Este módulo lo crea, lo lista, lo edita, lo cierra y lo reabre. También maneja la transferencia del dueño y la descarga en Excel, que están documentadas en [account-lifecycle](account-lifecycle.md).

## Alcance

**Hace:**
- Crear un negocio; quien lo crea queda como dueño (`OWNER`).
- Listar los negocios activos donde el usuario trabaja.
- Editar nombre y dirección.
- Cerrar un negocio sin deudas por cobrar.
- Listar los negocios cerrados del dueño y reabrirlos antes de que se borren.
- Transferir el negocio a un miembro y descargarlo en Excel (ver [account-lifecycle](account-lifecycle.md)).

**No hace:**
- Manejar el equipo (`business-user`).
- Borrar los datos de un negocio cerrado: lo hace el mantenimiento nocturno de `account-lifecycle` cuando vence el plazo.

## Modelos

| Modelo | Uso en este módulo |
| --- | --- |
| `Business` | `name`, `address` (opcional), `currency` (`COP`), `ownerId`, `inactivatedAt` (`null` = abierto) |
| `BusinessUser` | Al crear, la membresía `OWNER` de quien lo crea |
| `Debt` | Cerrar exige que no haya deudas `OPEN` ni `PARTIAL` |
| `Invitation`, `BusinessOwnershipTransfer` | Al cerrar, las pendientes se cancelan |
| `UserConsent` | Al crear, la aceptación de los documentos para negocios ([legal](legal.md)) |
| `AuditLog` | Creación, edición, cierre y reapertura, dentro de la misma transacción |

## Endpoints

Todos exigen `Authorization: Bearer <token>`. Usan el id en la ruta, no `x-business-id`.

| Método | Ruta | Quién | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/api/business` | Cualquiera | Crea el negocio. Body: `name` (1 a 100, se recorta), `address` (opcional, hasta 200; vacía = `null`), `currency` (solo `COP`), `acceptedLegalDocumentIds`. Máximo **10 negocios activos** como dueño |
| `GET` | `/api/business?page&limit&search&sortBy&order` | Cualquiera | Los negocios activos donde es dueño o miembro, con su equipo. `sortBy`: `createdAt` (por defecto) o `name` |
| `GET` | `/api/business/closed` | Cualquiera | Sus negocios **cerrados** como dueño, con `dataDeletionScheduledAt` y `canReactivate` |
| `GET` | `/api/business/:id` | Miembro | Detalle con el equipo. 400 si está cerrado |
| `PATCH` | `/api/business/:id` | Dueño | Edita `name` y `address`. La moneda no se edita. Si nada cambia responde 200 sin auditar |
| `PATCH` | `/api/business/:id/inactivate` | Dueño | Cierra el negocio. 400 si quedan deudas por cobrar, y dice cuántas. Devuelve `dataDeletionScheduledAt` |
| `PATCH` | `/api/business/:id/reactivate` | Dueño | Reabre un negocio cerrado. 400 si ya está abierto, si venció el plazo o si ya tiene 10 activos |
| `GET` | `/api/business/:id/export` | Dueño | Excel del negocio, también cerrado ([account-lifecycle](account-lifecycle.md#exportar-antes-de-cerrar)) |
| — | `/api/business/:id/ownership-transfer…` | Dueño o destinatario | Transferencia del dueño ([account-lifecycle](account-lifecycle.md#transferencia-business)) |

## Reglas de negocio

1. **Tope de 10 negocios activos como dueño.** Frena la creación masiva desde una sola cuenta; una tienda real tiene entre 1 y 5. Los cerrados no cuentan, y reabrir sí cuenta. Para que dos creaciones a la vez no se salten el tope, se bloquea la fila del usuario. Recibir un negocio por transferencia no revisa el tope.
2. **La moneda es COP.** La app muestra todo en pesos. Cuando haya otras monedas habrá que decidir qué pasa con las deudas ya registradas; por eso no se edita.
3. **Cerrar exige que no haya deudas por cobrar.** Las que queden se cobran, se descuentan o se anulan antes.
4. **Al cerrar, lo pendiente se cancela**: invitaciones y transferencia del dueño.
5. **Cerrar y fiar no se cruzan.** Cerrar bloquea la fila del negocio (`FOR UPDATE`) y fiar la toma con `FOR SHARE`. Si alguien fía mientras el dueño cierra, una de las dos espera a la otra; ya cerrado, fiar responde 400.
6. **Un negocio cerrado se puede reabrir hasta la fecha de borrado** (`inactivatedAt` + `CLOSED_BUSINESS_RETENTION_MONTHS`, 6 meses por defecto). Vuelve todo como estaba: clientes, deudas y equipo. Las invitaciones canceladas al cerrar no vuelven.
7. **Un negocio cerrado no sale en `GET /business`**, porque la guardia de negocio rechaza cualquier operación sobre él. El dueño lo ve en `GET /business/closed`.

### Transferencia del dueño

Las reglas están en [account-lifecycle](account-lifecycle.md). En esta revisión:
- **Proponer:** la validación de "ya hay una pendiente" y la creación van en una transacción con el negocio bloqueado. Antes, dos propuestas a la vez quedaban las dos pendientes.
- **Aceptar:** todo pasa con el negocio bloqueado, que es el mismo bloqueo que usa `business-user`. Si en ese momento sacan al destinatario del equipo, responde 400 y la propuesta queda cancelada; antes respondía 500. La auditoría va en la misma transacción.

### Auditoría

| Acción | Cuándo | `meta` |
| --- | --- | --- |
| `BUSINESS_CREATED` | Crear | `businessName`, `address` |
| `BUSINESS_UPDATED` | Editar, solo si algo cambió | `previousBusinessName`/`newBusinessName` y `previousAddress`/`newAddress`, solo de lo que cambió |
| `BUSINESS_DEACTIVATED` | Cerrar | — |
| `BUSINESS_REACTIVATED` | Reabrir | `inactivatedAt` (cuándo se había cerrado) |

En los `BUSINESS_UPDATED` anteriores a esta revisión, el "anterior" guarda en realidad el valor nuevo.

## Revisión del 2026-11-22

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | La auditoría de la edición guardaba como valor anterior el nuevo: no se sabía qué había antes | Se toma del negocio antes de editarlo, y solo de los campos que cambian |
| 2 | La auditoría de la creación se escribía fuera de la transacción: si la creación fallaba, quedaba un registro de un negocio que no existe | Dentro de la transacción |
| 3 | `name: "   "` se aceptaba como nombre | Se recorta y se exige texto |
| 4 | `currency` aceptaba cualquier texto, y la app muestra todo en pesos | Solo `COP` al crear; no se edita |
| 5 | `sortBy` sin validar: un campo inexistente respondía 500 | Solo `createdAt` o `name` |
| 6 | Cerrar cargaba todas las deudas del negocio para contarlas, y alguien podía fiar mientras se cerraba | Conteo, y bloqueo del negocio contra la creación de deudas |
| 7 | Al cerrar, las invitaciones y la transferencia pendientes seguían vivas | Se cancelan |
| 8 | El backend decía "hasta entonces puedes descargarla", pero la app no tenía cómo llegar a un negocio cerrado, y decía que no se podía reabrir | Decisión: `GET /business/closed` y `PATCH /business/:id/reactivate`, más la pantalla en la app |
| 9 | La app no tenía cómo editar el negocio | Decisión: pantalla "Editar negocio" |
| 10 | Sin tope de negocios por persona | Decisión: 10 activos como dueño |
| 11 | Transferencia: dos propuestas simultáneas, y 500 al aceptar si sacaban al miembro | Ver [Transferencia del dueño](#transferencia-del-dueño) |

**Fuera de este módulo, hecho en la misma rama:** las confirmaciones con contraseña no tenían límite de intentos (transferir el negocio, desactivar o eliminar la cuenta, cambiar la contraseña). Con la sesión de otra persona se podía probar contraseñas sin freno. Ahora el límite es de 5 intentos cada 15 minutos por usuario, sumando las cuatro rutas, y pasado el límite responden 429 (ver [users](users.md#permisos-y-seguridad)). Se probó con 9 casos.

## En la app

- **Perfil → Negocio:**
  - "Editar negocio" (nombre y dirección), solo para el dueño;
  - "Negocios cerrados", para todos.
- **Negocios cerrados:**
  - lista con la fecha de cierre y la de borrado;
  - al tocar uno se ofrece "Reabrir negocio" o "Descargar Excel";
  - vencido el plazo, solo se ofrece la descarga y se marca "Por eliminar";
  - al reabrir, queda como negocio activo.
- **Cerrar el negocio:** el diálogo ya no dice "No se puede volver a abrir". Dice que se puede reabrir o descargar desde "Negocios cerrados" hasta que se elimine.

## Qué se verificó

Script contra una base desechable con todas las migraciones (44 casos, todos OK; contra `develop` falla la mayoría):
- **Crear:**
  - nombre en blanco y moneda distinta de COP responden 400;
  - el nombre se recorta y la dirección vacía queda `null`;
  - queda auditado;
  - el negocio 11 activo responde 400 y no deja auditoría.
- **Listar:** `sortBy` inventado responde 400; se ordena por nombre; el miembro ve el negocio donde trabaja.
- **Editar:**
  - el miembro recibe 403;
  - la moneda no se edita;
  - el nombre en blanco responde 400;
  - la auditoría guarda el nombre anterior de verdad;
  - sin cambios no se audita;
  - se puede borrar la dirección.
- **Cerrar:**
  - el miembro recibe 403;
  - con 2 deudas responde 400 y dice "quedan 2 deudas";
  - sin deudas cierra, y cancela la invitación y la transferencia pendientes;
  - ya cerrado no se fía;
  - el miembro deja de verlo.
- **Cerrados:**
  - el dueño ve el cerrado con su fecha de borrado;
  - el miembro no ve cerrados ajenos;
  - el dueño lo descarga.
- **Reabrir:**
  - el miembro recibe 403, y otro usuario también;
  - con 10 activos no reabre;
  - cerrando otro, reabre: queda auditado, el equipo recupera el acceso y los clientes y deudas siguen ahí;
  - reabrir uno abierto responde 400;
  - vencido el plazo no reabre y sale con `canReactivate: false`.
- **Transferencia:**
  - tres propuestas a la vez dejan una sola pendiente;
  - una contraseña incorrecta responde 400;
  - si el destinatario ya no es miembro, responde 400 y la propuesta queda cancelada;
  - al aceptar, el nuevo dueño queda `OWNER` y el anterior `ADMIN`, y queda auditado.
- **Límite de contraseña** (9 casos):
  - 5 intentos fallidos repartidos entre desactivar, cambiar la contraseña y eliminar responden 400;
  - el 6.º responde 429 aunque la contraseña sea la correcta, y también frena cambiar la contraseña;
  - la cuenta no se desactiva y otro usuario no se afecta;
  - transferir el negocio: 5 fallidos y el 6.º responde 429; el mismo contador frena desactivar la cuenta.
- Las suites de `debts` (48), `payments` (55) y `business-user` (36) siguen pasando.
