# 💸 FIAO Backend (MVP)

## 🧩 Descripción general

**FIAO Backend** es el servidor principal del **MVP de FIAO**, una aplicación diseñada para gestionar **deudas, pagos y relaciones entre negocios y clientes (deudores)**.  
El sistema permite que cada **usuario o negocio** registre deudas, lleve control de pagos, gestione invitaciones, registre empleados y mantenga trazabilidad de las operaciones.

Este backend está desarrollado con **NestJS** y **Prisma ORM**, y se conecta a una base de datos **PostgreSQL** (tanto local como en Supabase).  
Se ha estructurado pensando en escalabilidad, modularidad y despliegue flexible para entornos **local**, **development** y **production**.

---

## ⚙️ Tecnologías principales

| Tecnología | Descripción |
|-------------|-------------|
| **NestJS** | Framework de Node.js con arquitectura modular y soporte completo para inyección de dependencias. |
| **Prisma ORM** | ORM moderno para bases de datos SQL, facilita migraciones, tipado y consultas seguras. |
| **PostgreSQL** | Motor de base de datos principal del proyecto. |
| **Supabase** | Usado como servicio de base de datos remoto (con conexión vía *pooling* y *direct*). |
| **dotenv-cli** | Carga automática de archivos `.env` según el entorno. |
| **cross-env** | Establece variables de entorno en scripts de forma portable. |
| **bcrypt / JWT / Passport** | Autenticación segura basada en tokens. |

---

## 🧱 Estructura de modelos Prisma

La base de datos se modela con Prisma ORM. A continuación se describe brevemente el propósito de cada modelo principal:

### 👤 `User`
Representa un usuario dentro del sistema.  
Puede ser **propietario de negocios**, **empleado**, o **cliente/deudor**.  
También lleva trazabilidad de quién crea deudas o pagos.

### 🏢 `Business`
Negocio o empresa registrada dentro del sistema.  
Cada negocio pertenece a un **usuario propietario (`owner`)** y puede tener múltiples **empleados (`BusinessUser`)**, **deudas**, **deudores** e **invitaciones**.

### 👥 `BusinessUser`
Define la relación entre usuarios y negocios.  
Permite roles dentro del negocio (`ADMIN`, `CASHIER`, `VIEWER`) y mantiene integridad entre ambos.

### 💰 `Debt`
Representa una deuda registrada por un negocio hacia un deudor.  
Incluye montos, balance actual, estado (`OPEN`, `PAID`, `CANCELLED`), y la relación con quien la creó.

### 🧾 `Payment`
Registra pagos parciales o totales realizados sobre una deuda.  
Asociado al usuario que lo crea y al método de pago (`CASH`, `TRANSFER`, etc).

### 🙋‍♂️ `Debtor`
Persona (cliente o tercero) asociada a un negocio con deudas activas o pagadas.  
Puede ser también un `User` del sistema si fue invitado y se registró.

### ✉️ `Invitation`
Permite invitar a deudores o usuarios a un negocio mediante **correo o teléfono**.  
Cada invitación tiene un código único y un estado (`PENDING`, `ACCEPTED`, `EXPIRED`).

### 🕵️ `AuditLog`
Registra acciones dentro del sistema para trazabilidad: quién hizo qué, sobre qué entidad y cuándo.

---

## 🧠 Flujo de entornos y configuración

El proyecto se maneja mediante tres entornos:

| Entorno | Archivo `.env` | Uso principal |
|----------|----------------|----------------|
| **Local** | `.env.local` | Desarrollo local con base de datos PostgreSQL local. |
| **Development** | `.env.development` | Entorno de desarrollo conectado a Supabase (con *directUrl* para migraciones). |
| **Production** | `.env.production` | Entorno productivo conectado a Supabase (con *directUrl* para migraciones). |

---

## 🧾 Ejemplo de variables de entorno

### 🔹 `.env.local`
```env
NODE_ENV=local
PORT=3000

# PostgreSQL local
PG_USER=postgres
PG_PASSWORD=postgres
PG_DB=fiao_db
PG_HOST=localhost
PG_PORT=5432

# Prisma URLs
DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}?schema=public
DIRECT_URL=${DATABASE_URL}

# JWT
JWT_SECRET="local_secret_key"
JWT_EXPIRES_IN="1d"
```

### 🔹 `.env.development`
```env
NODE_ENV=development
PORT=3000

# Supabase (pooler)
DATABASE_URL="postgresql://user:pass@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Direct connection (migrations)
DIRECT_URL="postgresql://user:pass@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

JWT_SECRET="dev_secret_key"
JWT_EXPIRES_IN="1d"
```

### 🔹 `.env.production`
```env
NODE_ENV=production
PORT=3000

# Supabase (pooler)
DATABASE_URL="postgresql://user:pass@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Direct connection (migrations)
DIRECT_URL="postgresql://user:pass@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

JWT_SECRET="prod_secret_key"
JWT_EXPIRES_IN="1d"
```

---

## 🗃️ Prisma y base de datos

### 📦 Configuración en `schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Esto permite usar:
- `DATABASE_URL` → conexión normal (pooling)
- `DIRECT_URL` → conexión directa (para migraciones o seeds)

---

## 🧭 Prisma Service

Archivo: `src/prisma/prisma.service.ts`
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {
    super({
      datasources: {
        db: {
          url:
            configService.get<string>('database.directUrl') ||
            configService.get<string>('database.url'),
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Conectado a la base de datos.');
    console.log('🌍 NODE_ENV:', this.configService.get<string>('app.nodeEnv'));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

---

## 🧰 Scripts útiles

### 🚀 Inicio de servidor
| Script | Descripción |
|---------|-------------|
| `npm run start:local` | Inicia servidor con `.env.local`. |
| `npm run start:dev` | Inicia con `.env.development`. |
| `npm run start:prod` | Ejecuta versión compilada (`dist`) en producción. |

---

## 🧱 Migraciones de base de datos (Prisma)

Todo cambio en la estructura de la base (tablas, columnas, enums, índices) se hace con una **migración**: un archivo SQL dentro de `prisma/migrations/` que queda en Git. Así cada base (la local de cada desarrollador, development y production) llega exactamente al mismo esquema, en el mismo orden.

### Reglas

1. **`schema.prisma` nunca se cambia sin su migración.** Cambio de schema y migración van en el mismo commit y en el mismo pull request.
2. **Las migraciones se crean solo contra tu base local** (`migrate:local`). Las bases compartidas (development y production) solo reciben `migrate:deploy:*`.
3. **Una migración ya aplicada en development o production no se edita ni se borra.** Si algo quedó mal, se corrige con una migración nueva.
4. **Primero development, después production.** Nunca se aplica en production una migración que no se haya probado en development.
5. **Quien hace la tarea que cambia la base es quien aplica su migración** en development y en production.
6. **No se usa `prisma db push`.** Cambia la base sin dejar migración y desalinea el historial.

### `migrate dev` vs `migrate deploy`

| | `prisma migrate dev` | `prisma migrate deploy` |
| --- | --- | --- |
| Para qué | Desarrollar: **crea** migraciones nuevas a partir de `schema.prisma` y las aplica | Desplegar: **solo aplica** las migraciones que ya existen en `prisma/migrations/` |
| Dónde | Solo en tu base local | Development y production |
| ¿Crea archivos? | Sí | No |
| ¿Puede borrar datos? | Sí: si detecta diferencias, ofrece resetear la base | No: si algo no cuadra, falla sin tocar nada |
| ¿Ejecuta `prisma generate`? | Sí | No |

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
| `npm run migrate:deploy:production` | Production | Aplica las migraciones pendientes en production |
| `npm run generate` | — | Regenera el cliente de Prisma (`@prisma/client`) desde `schema.prisma` |

### Flujos

**1. Preparar tu base local (primera vez)**

1. Crea en tu PostgreSQL una base vacía (por ejemplo `fiao_db`) y configúrala en `.env.local`.
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

**4. Aplicar en development y production**

Lo hace quien desarrolló la tarea:

1. Con el pull request aprobado y fusionado:
   ```bash
   npm run migrate:status:development
   npm run migrate:deploy:development
   ```
2. Prueba la funcionalidad en development.
3. Al desplegar esa versión en production, aplica la migración **antes** de publicar el código nuevo:
   ```bash
   npm run migrate:status:production
   npm run migrate:deploy:production
   ```

`migrate:status:*` sirve para confirmar antes de aplicar que solo están pendientes las migraciones esperadas.

### Cambios que borran o renombran

Borrar o renombrar columnas o tablas rompe el código que todavía las usa. Hazlo en dos pasos (expand/contract):

1. **Agregar:** crea lo nuevo (columna, tabla), despliega el código que lo usa y, si hace falta, copia los datos.
2. **Quitar:** en una tarea posterior, cuando nada use lo viejo, crea la migración que lo borra.

Así, si hay que revertir el código, la base sigue siendo compatible.

### Si algo sale mal

- **La migración falló a la mitad en development o production:** no la edites. Corrige el problema en la base si hace falta, márcala con `npx prisma migrate resolve --rolled-back <nombre>` usando el script de entorno correspondiente, y crea una migración nueva y corregida.
- **La migración se aplicó bien, pero el cambio era incorrecto:** se corrige hacia adelante, con una migración nueva que revierta o ajuste el cambio. No se hace rollback del historial.
- **`migrate:local` dice que hay diferencias (drift) y ofrece resetear:** alguien cambió tu base local sin migración. Si no te importan esos datos, acepta el reset; si no, cancela y pide ayuda.
- **Dos personas crearon migraciones a la vez:** si al hacer `git pull` aparece la migración de otra persona antes de la tuya y ambas tocan lo mismo, borra la carpeta de tu migración (si aún no se aplicó fuera de tu base local), ejecuta `npm run migrate:reset:local` y vuelve a crearla.

### ¿Cuándo hace falta `prisma generate`?

`@prisma/client` se genera a partir de `schema.prisma`; sin él, el código no ve los modelos ni los campos nuevos. `migrate:local` ya lo ejecuta automáticamente. Ejecuta `npm run generate` a mano:

- después de `npm install` en un clon nuevo, si los tipos de Prisma no aparecen;
- en el servidor de despliegue, antes de `npm run build`;
- si TypeScript no reconoce un campo que sí está en `schema.prisma`.

### Probar la versión Java en local

La versión Java usa Flyway, que crea su propia tabla (`flyway_schema_history`). Usa **una base local separada** para Java (por ejemplo `fiao_db_java`). Si Java corre sobre la misma base que Nest, `migrate:local` detecta esa tabla como diferencia y ofrece resetear.

---

## ⚖️ Documentos legales y aceptación (Ley 1581 de 2012)

Para registrarse, el usuario debe aceptar los **términos y condiciones** y la **política de tratamiento de datos**. La ley exige conservar la prueba de esa autorización, así que el backend guarda:

- **`LegalDocument`**: cada versión de cada documento, con su texto completo y su huella SHA-256. Una versión publicada **no se modifica**: si el texto cambia, se publica una versión nueva. La vigente de cada tipo es la más reciente con `publishedAt` ya cumplida.
- **`UserConsent`**: qué versión aceptó cada usuario, cuándo, desde qué IP y con qué navegador o app. Solo se agregan filas.

**Flujo:**

1. El frontend obtiene los textos vigentes con `GET /api/legal/current` (público) y los muestra.
2. En el registro (`POST /api/users`) envía `acceptedLegalDocumentIds` con los ids de **todos** los documentos vigentes. El usuario y sus aceptaciones se crean en una sola transacción.
3. Login y refresh devuelven `pendingLegalDocuments`. Si no está vacío (por ejemplo, porque se publicó una versión nueva), el frontend muestra esos documentos (`GET /api/legal/pending`) y registra la aceptación con `POST /api/legal/accept`.

**Publicar una versión nueva:**

Los textos se guardan en el repositorio, en `legal/terms-and-conditions/<version>.md` y `legal/privacy-policy/<version>.md`, y se cargan en cada base con:

```bash
npm run legal:publish:local -- --type PRIVACY_POLICY --version 2026-10 --file legal/privacy-policy/2026-10.md --url https://fiao.co/privacidad
```

- `--type`: `TERMS_AND_CONDITIONS` o `PRIVACY_POLICY`.
- `--url` (opcional): página pública donde también está publicado el texto.
- `--published-at` (opcional): fecha desde la que rige; por defecto, ahora.

El mismo comando existe para `development` y `production` (`legal:publish:development`, `legal:publish:production`). Publicar dos veces la misma versión con el mismo texto no hace nada; con un texto distinto, falla.

> ⚠️ Sin documentos vigentes publicados, el registro responde 503. Al preparar un entorno nuevo, publica ambos documentos antes de abrir el registro.

---

## 🗓️ Ciclo de vida de cuentas y tarea diaria

El usuario puede **desactivar** su cuenta (reversible) o **pedir su eliminación** (15 días de gracia y luego anonimización). Un dueño puede **transferir** su negocio a un miembro, que debe aceptarlo, y **descargar en Excel** su información. Una tarea diaria (3:00 a. m., hora Colombia) aplica los plazos de retención.

Estados, endpoints, qué se borra y qué se conserva, variables y la tarea diaria: [docs/modulos/account-lifecycle.md](docs/modulos/account-lifecycle.md).

```bash
npm run build
npm run maintenance:run:local   # ejecutar la tarea diaria a mano
```

---

## 🧩 Dependencias clave

- `@nestjs/common`, `@nestjs/core`, `@nestjs/config` → estructura principal de NestJS
- `@prisma/client`, `prisma` → ORM y cliente de base de datos
- `bcrypt`, `jsonwebtoken`, `passport-jwt` → autenticación y seguridad
- `dotenv-cli`, `cross-env` → manejo de entornos
- `typescript`, `ts-node` → desarrollo en TypeScript

---

## 🧑‍💻 Autor

**Equipo FIAO**  
Desarrollado por [Mauricio Carbal](#) 🧠  
Con arquitectura y flujo diseñados para escalar hacia futuras integraciones.

---

## 🚀 Estado del proyecto

> **MVP en desarrollo.**  
> Soporta:
> - Autenticación básica
> - Registro de negocios, usuarios y deudas
> - Pagos e invitaciones
> - Entornos configurables (local/dev/prod)
> - Integración con Supabase como DB remota

---

## 🧩 Próximos pasos

- [ ] Implementar auditoría avanzada (`AuditLog`)
- [ ] Endpoints para gestión de roles dentro de negocios
- [ ] Integrar cacheo selectivo (Redis o similar)
- [ ] Publicar documentación de API con Swagger

---

### 🧡 Contribuye
Si deseas colaborar:
```bash
git clone https://github.com/tu-repo/fiao-backend.git
cd fiao-backend
npm install
npm run migrate:local
npm run start:local
```

---

✨ **FIAO Backend** — un sistema simple, modular y listo para escalar 🚀
