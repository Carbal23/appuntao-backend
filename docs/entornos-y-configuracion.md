# Entornos y configuración

## Entornos

| Entorno | `NODE_ENV` | Archivo | Base de datos |
| --- | --- | --- | --- |
| Local | `local` | `.env.local` | PostgreSQL en tu máquina |
| Development | `development` | `.env.development` | Supabase (development) |
| Production | `production` | `.env.production` | Supabase (production) |

La aplicación carga `.env.<NODE_ENV>` al arrancar (`.env.local` si `NODE_ENV` no está definido). Los scripts `start:*` y `migrate:*` usan `dotenv-cli` para cargar el archivo correcto.

Los archivos `.env*` **no van en Git**. En el servidor de despliegue las variables se configuran en el panel del proveedor (ver [despliegue.md](despliegue.md)).

## Variables

| Variable | Obligatoria | Default | Para qué |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `local` | Entorno. Con `production` se desactiva Swagger |
| `PORT` | No | `3000` | Puerto HTTP |
| `DATABASE_URL` | Sí | — | Conexión que usa la aplicación. En Supabase, la del **pooler** (puerto 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Sí | — | Conexión **directa** (puerto 5432), usada por el CLI de Prisma para migraciones. En local, igual a `DATABASE_URL` |
| `JWT_SECRET` | Sí | — | Firma de los access tokens. **Mínimo 32 caracteres** o la app no arranca |
| `JWT_EXPIRES_IN` | No | `1d` | Duración del access token |
| `REFRESH_TOKEN_EXPIRES_DAYS` | No | `30` | Días de vigencia del refresh token |
| `RESEND_API_KEY` | Para enviar correos | — | API key de Resend |
| `EMAIL_FROM` | No | `APPUNTAO <onboarding@resend.dev>` | Remitente. El dominio debe estar verificado en Resend |
| `LOGO_URL` | No | — | URL pública del logo para los correos. Sin ella se usa un logo de texto |

## Ejemplos

### `.env.local`

```env
NODE_ENV=local
PORT=3000

# PostgreSQL local
PG_USER=postgres
PG_PASSWORD=postgres
PG_DB=appuntao_db
PG_HOST=localhost
PG_PORT=5432

# Prisma
DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}?schema=public
DIRECT_URL=${DATABASE_URL}

# JWT (mínimo 32 caracteres)
JWT_SECRET="cambia_esto_por_un_secreto_de_32_caracteres_o_mas"
JWT_EXPIRES_IN="1d"

# Email
RESEND_API_KEY="re_..."
EMAIL_FROM="APPUNTAO <onboarding@resend.dev>"
```

### `.env.development` y `.env.production`

```env
NODE_ENV=development   # o production
PORT=3000

# Supabase: pooler (aplicación)
DATABASE_URL="postgresql://user:pass@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Supabase: conexión directa (migraciones)
DIRECT_URL="postgresql://user:pass@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

JWT_SECRET="..."       # distinto por entorno, mínimo 32 caracteres
JWT_EXPIRES_IN="1d"

RESEND_API_KEY="re_..."
EMAIL_FROM="APPUNTAO <noreply@tu-dominio>"
```

## ¿Por qué dos URLs de base de datos?

Supabase ofrece un **pooler** (PgBouncer) que reparte pocas conexiones reales entre muchas peticiones: es lo que debe usar la aplicación. Pero las migraciones necesitan una conexión directa, porque el pooler en modo transacción no soporta lo que hace `prisma migrate`. Por eso `schema.prisma` declara las dos:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```
