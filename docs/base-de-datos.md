# Base de datos y migraciones

## Modelos

Resumen de cada modelo de `prisma/schema.prisma`. El detalle de cómo los usa cada módulo está en su documento.

| Modelo | Qué representa |
| --- | --- |
| `User` | Persona registrada. Puede ser dueña de negocios, miembro de un equipo o deudor vinculado. Tiene un rol de plataforma (`Role`) e `inactivatedAt` para la inactivación |
| `Business` | Negocio. Pertenece a un `owner` y tiene equipo, deudores, deudas, pagos e invitaciones. Moneda por defecto `COP` |
| `BusinessUser` | Membresía de un usuario en un negocio, con su rol (`OWNER`, `ADMIN`, `CASHIER`, `VIEWER`). Única por par negocio-usuario |
| `Debtor` | Cliente de un negocio. Puede existir sin cuenta y vincularse después a un `User` |
| `Debt` | Deuda de un deudor con un negocio: `amount` original, `balance` pendiente, estado (`OPEN`, `PARTIAL`, `PAID`, `CANCELLED`) y fecha de vencimiento opcional |
| `Payment` | Movimiento sobre una deuda: pago (`PAYMENT`), ajuste (`ADJUSTMENT`) o reverso (`REVERSAL`), con método (`CASH`, `TRANSFER`, `OTHER`) |
| `PaymentGroup` | Agrupa los pagos de un mismo abono repartido entre varias deudas de un deudor. `reversedAt` marca si se reversó |
| `Invitation` | Invitación a un deudor (`DEBTOR`) o a un miembro del equipo (`BUSINESS_USER`, con su rol), con código único, vencimiento y estado |
| `RefreshToken` | Refresh tokens guardados como hash, agrupados por familia (rotación) y asociados a un dispositivo |
| `AuthLog` | Eventos de seguridad: logins exitosos y fallidos, bloqueos, logouts, cambios de contraseña |
| `AuditLog` | Auditoría de acciones: quién hizo qué, sobre qué entidad y con qué datos |

Los montos usan `Decimal(12, 2)`.

## Migraciones

Todo cambio en la estructura de la base (tablas, columnas, enums, índices) se hace con una **migración**: un archivo SQL dentro de `prisma/migrations/` que queda en Git. Así cada base (la local de cada desarrollador, development y production) llega exactamente al mismo esquema, en el mismo orden.

### Reglas

1. **`schema.prisma` nunca se cambia sin su migración.** Cambio de schema y migración van en el mismo commit y en el mismo pull request.
2. **Las migraciones se crean solo contra tu base local** (`migrate:local`). Las bases compartidas (development y production) solo reciben `migrate deploy`.
3. **Una migración ya aplicada en development o production no se edita ni se borra.** Si algo quedó mal, se corrige con una migración nueva.
4. **Primero development, después production.** Nunca se aplica en production una migración que no se haya probado en development.
5. **Quien hace la tarea que cambia la base es quien aplica su migración** en development (en production se aplica sola al desplegar, ver [despliegue.md](despliegue.md)).
6. **No se usa `prisma db push`.** Cambia la base sin dejar migración y desalinea el historial.

### `migrate dev` vs `migrate deploy`

| | `prisma migrate dev` | `prisma migrate deploy` |
| --- | --- | --- |
| Para qué | Desarrollar: **crea** migraciones nuevas a partir de `schema.prisma` y las aplica | Desplegar: **solo aplica** las migraciones que ya existen en `prisma/migrations/` |
| Dónde | Solo en tu base local | Development y production |
| ¿Crea archivos? | Sí | No |
| ¿Puede borrar datos? | Sí: si detecta diferencias, ofrece resetear la base | No: si algo no cuadra, falla sin tocar nada |
| ¿Ejecuta `prisma generate`? | Sí | No |
| ¿Falla si no hay nada pendiente? | — | No: informa que no hay migraciones pendientes y termina bien |

Por eso `migrate dev` nunca se ejecuta contra una base compartida: un "sí" por error al reset borra los datos de todo el equipo.

### Scripts

| Script | Base | Qué hace |
| --- | --- | --- |
| `npm run migrate:local -- --name <descripcion>` | Local | Crea la migración con tus cambios de `schema.prisma`, la aplica y regenera el cliente |
| `npm run migrate:local` | Local | Sin cambios en el schema: aplica las migraciones nuevas que trajiste con `git pull` |
| `npm run migrate:reset:local` | Local | ⚠️ Borra tu base local y la reconstruye con todas las migraciones |
| `npm run migrate:status:local` | Local | Muestra qué migraciones faltan por aplicar |
| `npm run migrate:status:development` | Development | Ídem, en development |
| `npm run migrate:status:production` | Production | Ídem, en production |
| `npm run migrate:deploy:development` | Development | Aplica las migraciones pendientes en development |
| `npm run migrate:deploy:production` | Production | Aplica las migraciones pendientes en production, desde tu máquina |
| `npm run generate` | — | Regenera el cliente de Prisma (`@prisma/client`) desde `schema.prisma` |

Los scripts `:development` y `:production` cargan tu `.env.development` o `.env.production` local. Sirven para operar esas bases desde tu máquina; el servidor de despliegue no los usa.

### Flujos

**1. Preparar tu base local (primera vez)**

1. Crea en tu PostgreSQL una base vacía (por ejemplo `appuntao_db`) y configúrala en `.env.local`.
2. Ejecuta:
   ```bash
   npm install
   npm run migrate:local
   ```
   Se aplican todas las migraciones y se genera el cliente.

**2. Traer los cambios del equipo**

Después de cada `git pull`, si llegaron migraciones nuevas:
```bash
npm run migrate:local
```

**3. Hacer un cambio en la base**

1. Modifica `schema.prisma`.
2. Crea la migración con un nombre descriptivo en inglés y en snake_case:
   ```bash
   npm run migrate:local -- --name add_due_date_to_debt
   ```
   Si quieres revisar o editar el SQL antes de aplicarlo (por ejemplo, para rellenar datos existentes), agrega `--create-only`, edita `prisma/migrations/<fecha>_<nombre>/migration.sql` y luego ejecuta `npm run migrate:local`.
3. Revisa el SQL generado, sobre todo si borra o renombra columnas.
4. Haz commit de `schema.prisma`, la carpeta de la migración y el código que la usa, y abre el pull request.

**4. Aplicar en development**

Con el pull request aprobado y fusionado, lo hace quien desarrolló la tarea:

```bash
npm run migrate:status:development
npm run migrate:deploy:development
```

Luego prueba la funcionalidad en development.

**5. Aplicar en production**

El build de Render ejecuta `prisma migrate deploy` en cada despliegue de `master`, así que la migración se aplica sola. Antes de fusionar a `master`, revisa qué se va a aplicar:

```bash
npm run migrate:status:production
```

`migrate:status:*` sirve para confirmar que solo están pendientes las migraciones esperadas.

### Cambios que borran o renombran

Borrar o renombrar columnas o tablas rompe el código que todavía las usa. Hazlo en dos pasos (expand/contract):

1. **Agregar:** crea lo nuevo (columna, tabla), despliega el código que lo usa y, si hace falta, copia los datos.
2. **Quitar:** en una tarea posterior, cuando nada use lo viejo, crea la migración que lo borra.

Así, si hay que revertir el código, la base sigue siendo compatible. Esto importa más ahora que la migración corre durante el build: se aplica justo antes de que el código nuevo quede publicado.

### Si algo sale mal

- **La migración falló a la mitad en development o production:** no la edites. Corrige el problema en la base si hace falta, márcala con `npx prisma migrate resolve --rolled-back <nombre>` contra esa base, y crea una migración nueva y corregida.
- **La migración se aplicó bien, pero el cambio era incorrecto:** se corrige hacia adelante, con una migración nueva que revierta o ajuste el cambio. No se hace rollback del historial.
- **`migrate:local` dice que hay diferencias (drift) y ofrece resetear:** alguien cambió tu base local sin migración. Si no te importan esos datos, acepta el reset; si no, cancela y pide ayuda.
- **Dos personas crearon migraciones a la vez:** si al hacer `git pull` aparece la migración de otra persona antes de la tuya y ambas tocan lo mismo, borra la carpeta de tu migración (si aún no se aplicó fuera de tu base local), ejecuta `npm run migrate:reset:local` y vuelve a crearla.

### ¿Cuándo hace falta `prisma generate`?

`@prisma/client` se genera a partir de `schema.prisma`; sin él, el código no ve los modelos ni los campos nuevos. `migrate:local` ya lo ejecuta automáticamente. Ejecuta `npm run generate` a mano:

- después de `npm install` en un clon nuevo, si los tipos de Prisma no aparecen;
- en el servidor de despliegue, antes de `npm run build` (ya está en el build command);
- si TypeScript no reconoce un campo que sí está en `schema.prisma`.

### Probar la versión Java en local

La versión Java usa Flyway, que crea su propia tabla (`flyway_schema_history`). Usa **una base local separada** para Java (por ejemplo `appuntao_db_java`). Si Java corre sobre la misma base que Nest, `migrate:local` detecta esa tabla como diferencia y ofrece resetear.
