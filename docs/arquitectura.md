# Arquitectura

Cómo está organizado el backend y qué piezas comparten todos los módulos.

## Estructura de carpetas

```
prisma/
├── schema.prisma          modelos de la base de datos
└── migrations/            historial de migraciones (va en Git)
src/
├── main.ts                arranque: prefijo /api, trust proxy, ValidationPipe, Swagger, CORS
├── maintenance.ts         ejecuta a mano la tarea diaria de account-lifecycle
├── app.module.ts          módulo raíz: config global y registro de módulos
├── config/                configuración tipada con registerAs (app, database, jwt)
├── prisma/                PrismaModule y PrismaService
├── providers/             integraciones externas (email.provider.ts → Resend)
├── common/
│   ├── decorators/        @GetUser, @CurrentBusiness, @ReqContext
│   ├── pagination/        PaginationDto, construcción de where/orderBy, paginate()
│   ├── dto/               DTOs compartidos (ApiResponseDto)
│   ├── swagger/           decorators de Swagger (@ApiAuth, @BusinessProtected)
│   ├── validation/        normalización y validación de correo, teléfono, documento,
│   │                      nombres y contraseña; búsqueda de usuario por identificador
│   └── utils/             extractBusinessId
└── <modulo>/              un módulo por dominio
scripts/                   scripts de operación (publicar documentos legales)
```

## Anatomía de un módulo

Cada dominio (`debts`, `payments`, `invitations`, ...) sigue la misma forma:

| Archivo | Responsabilidad |
| --- | --- |
| `<modulo>.module.ts` | Declara controller y service, importa lo que necesita |
| `<modulo>.controller.ts` | Rutas HTTP, guards, roles y Swagger. Sin lógica de negocio |
| `<modulo>.service.ts` | Lógica de negocio y acceso a datos con `PrismaService` |
| `dto/` | Entrada validada con `class-validator` y DTOs de respuesta para Swagger |
| `<entidad>.select.ts` | `select` de Prisma reutilizable, para devolver siempre los mismos campos |
| `utils/`, `helpers/` | Funciones propias del módulo |

## Arranque (`main.ts`)

- Si `TRUST_PROXY` es mayor que 0, Express toma la IP real del cliente de `X-Forwarded-For`. Necesario detrás de Render, para que los límites de intentos y los registros de seguridad no vean a todos con la IP del proxy.
- Todas las rutas tienen el prefijo **`/api`**.
- `ValidationPipe` global con `whitelist`, `forbidNonWhitelisted` y `transform`: los campos que no están en el DTO se rechazan con 400, y los query params se convierten al tipo declarado.
- **Swagger** se publica en `/docs` solo cuando `NODE_ENV !== 'production'`.
- CORS habilitado.
- Escucha en `PORT` (3000 por defecto) sobre `0.0.0.0`.

## Configuración

`ConfigModule` es global y carga `.env.<NODE_ENV>` (por defecto `.env.local`). Las variables se leen a través de los namespaces de `src/config/`:

| Namespace | Claves |
| --- | --- |
| `app` | `nodeEnv`, `port`, `isDev`, `isLocal`, `isProd` |
| `database` | `url`, `directUrl` |
| `jwt` | `secret`, `expiresIn`, `refreshTokenExpiresDays` |

`jwt.config.ts` hace fallar el arranque si `JWT_SECRET` no existe o tiene menos de 32 caracteres. Detalle de cada variable en [entornos-y-configuracion.md](entornos-y-configuracion.md).

## Autenticación y autorización

Los guards se aplican **por controller o por ruta** con `@UseGuards`. No hay guards globales. El orden típico es:

```ts
@UseGuards(JwtAuthGuard, BusinessContextGuard, BusinessRoleGuard)
```

| Pieza | Qué hace |
| --- | --- |
| `JwtAuthGuard` | Valida el access token (`Authorization: Bearer ...`) con `JwtStrategy` y deja el usuario en `request.user` |
| `RolesGuard` + `@Roles(...)` | Restringe por **rol de plataforma** (`User.role`: `USER` o `ADMIN`) |
| `BusinessContextGuard` | Exige el negocio activo, verifica que exista, que no esté inactivado y que el usuario sea miembro. Deja `request.business` |
| `BusinessRoleGuard` + `@BusinessRoles(...)` | Restringe por **rol dentro del negocio** (`BusinessUser.role`). Sin `@BusinessRoles`, deja pasar |
| `LoginThrottlerGuard` | Limita intentos de login por IP + identificador y registra el bloqueo en `auth-log` |
| `ThrottlerGuard` + `@Throttle(...)` | Límite de peticiones por IP en rutas sensibles (registro, lookup, códigos de invitación). Los contadores viven en memoria de cada instancia |

`JwtStrategy` busca al usuario en la base en cada petición: si está inactivado responde 401, aunque el token no haya vencido. Detalle en [modulos/auth.md](modulos/auth.md).

### Dos tipos de rol

- **Rol de plataforma** (`User.role`): qué puede hacer la persona en todo el sistema. `ADMIN` es soporte o backoffice; el registro siempre crea `USER`.
- **Rol en el negocio** (`BusinessUser.role`): qué puede hacer dentro de un negocio concreto.

| Rol en el negocio | Uso previsto |
| --- | --- |
| `OWNER` | Dueño del negocio (también figura en `Business.ownerId`) |
| `ADMIN` | Gestiona equipo, deudas y pagos |
| `CASHIER` | Registra deudas y pagos |
| `VIEWER` | Solo lectura |

Qué rol exige cada endpoint se documenta en el documento de cada módulo.

### Negocio activo

Las rutas que trabajan sobre un negocio necesitan saber cuál. `extractBusinessId` lo busca, en este orden, en:

1. el header **`x-business-id`** (la forma recomendada),
2. el parámetro de ruta `businessId`,
3. el query param `businessId`.

En el controller se obtiene con `@CurrentBusiness()`.

## Decorators compartidos

| Decorator | Devuelve |
| --- | --- |
| `@GetUser()` / `@GetUser('id')` | El usuario autenticado, o uno de sus campos |
| `@CurrentBusiness()` | El id del negocio activo (400 si no viene) |
| `@ReqContext()` | `{ ipAddress, userAgent }`, para los registros de seguridad |

## Paginación

Los listados reciben `PaginationDto` (o un DTO que lo extiende):

| Query param | Default | Notas |
| --- | --- | --- |
| `page` | `1` | Mínimo 1 |
| `limit` | `10` | Entre 1 y 100 |
| `search` | — | Búsqueda de texto, según el módulo |
| `sortBy` | — | Campo de ordenamiento, según el módulo |
| `order` | `desc` | `asc` o `desc` |

Las utilidades de `common/pagination/utils` arman el `where`, el `orderBy` y la respuesta paginada con su metadata.

## Base de datos

`PrismaService` extiende `PrismaClient` y se conecta con `DATABASE_URL`. `DIRECT_URL` no la usa la aplicación: la usa el CLI de Prisma para las migraciones (`directUrl` en `schema.prisma`). Ver [base-de-datos.md](base-de-datos.md).

## Integraciones externas

| Proveedor | Archivo | Uso |
| --- | --- | --- |
| Resend | `src/providers/email.provider.ts` | Correos de invitación (HTML con tablas y estilos en línea, más versión en texto plano) |

## Tareas programadas

| Tarea | Cuándo | Documento |
| --- | --- | --- |
| Mantenimiento de cuentas y negocios | Todos los días, 3:00 a. m. hora Colombia | [modulos/account-lifecycle.md](modulos/account-lifecycle.md#tarea-diaria) |
