# Despliegue

El backend de production se despliega en **Render** desde la rama **`master`**. Cada push a `master` dispara un despliegue.

## Configuración del servicio

| Campo | Valor |
| --- | --- |
| Branch | `master` |
| Build Command | `npm install --include=dev && npx prisma generate && npm run build && npx prisma migrate deploy` |
| Start Command | `npm run start:prod` |
| Health Check Path | `/api/health` |

### Qué hace cada paso del build

| Paso | Por qué |
| --- | --- |
| `npm install --include=dev` | Render define `NODE_ENV=production`, y con eso npm se salta las `devDependencies`. Las necesitamos: `@nestjs/cli` y `typescript` para compilar, `prisma` (el CLI) para generar y migrar, y `cross-env` para `start:prod` |
| `npx prisma generate` | Genera `@prisma/client` a partir de `schema.prisma` |
| `npm run build` | Compila a `dist/` |
| `npx prisma migrate deploy` | Aplica las migraciones pendientes en la base de production. Si no hay ninguna, no hace nada y termina bien |

Los pasos van unidos con `&&`: si uno falla, los siguientes no se ejecutan y Render no publica la versión nueva. La migración va al final para que solo se aplique si el código compiló.

> Si el plan de Render ofrece **Pre-Deploy Command**, es mejor mover ahí `npx prisma migrate deploy` y sacarlo del build: corre justo antes de publicar y, si falla, el despliegue se cancela.

### ¿Por qué `npx prisma migrate deploy` y no `npm run migrate:deploy:production`?

Los scripts `migrate:*:<entorno>` cargan un archivo `.env.<entorno>` con `dotenv-cli`. Ese archivo no existe en Render (no está en Git): ahí las variables vienen del panel. Usar el comando directo evita depender de un archivo que no está y deja claro de dónde sale la conexión.

## Variables de entorno en Render

Se configuran en **Environment** del servicio. Ver la lista completa en [entornos-y-configuracion.md](entornos-y-configuracion.md). Las imprescindibles:

- `NODE_ENV=production`
- `DATABASE_URL` (pooler de Supabase)
- `DIRECT_URL` (conexión directa de Supabase; la necesita `migrate deploy`)
- `JWT_SECRET` (mínimo 32 caracteres)
- `RESEND_API_KEY` y `EMAIL_FROM` (dominio verificado en Resend)

## Antes de fusionar a `master`

1. Comprueba qué migraciones se van a aplicar:
   ```bash
   npm run migrate:status:production
   ```
2. Revisa el SQL de cada migración pendiente. Si borra o renombra columnas, confirma que sigue el patrón expand/contract de [base-de-datos.md](base-de-datos.md#cambios-que-borran-o-renombran).
3. Confirma que esas migraciones ya se probaron en development.
4. Si el cambio necesita variables de entorno nuevas, agrégalas en Render **antes** del despliegue.
