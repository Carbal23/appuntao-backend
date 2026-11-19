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
- `DATABASE_URL`: pooler de Supabase en **modo transacción**, puerto **6543**, con `?pgbouncer=true&connection_limit=5`
- `DIRECT_URL`: pooler en **modo sesión**, puerto **5432**. La usa `migrate deploy`
- `JWT_SECRET` (mínimo 32 caracteres)
- `RESEND_API_KEY` y `EMAIL_FROM` (dominio verificado en Resend)

### Conexiones a Supabase

El pooler de Supabase tiene dos modos con límites distintos:

| Modo | Puerto | Cómo reparte las conexiones | Para qué |
| --- | --- | --- | --- |
| Sesión | 5432 | Le da una conexión real a cada cliente mientras siga conectado. Tope de 15 en el plan gratuito | Migraciones (`DIRECT_URL`) |
| Transacción | 6543 | Presta la conexión solo mientras dura cada consulta o transacción | La app (`DATABASE_URL`) |

**Por qué `connection_limit=5`.** Prisma abre por defecto *núcleos × 2 + 1* conexiones, y en Render Node ve los núcleos de la máquina física. Con `DATABASE_URL` en el 5432, un solo proceso del backend llegó a ocupar las 15 conexiones del modo sesión, que quedaron tomadas aunque no se usaran. El siguiente build falló con `EMAXCONNSESSION` en `migrate deploy`, porque la instancia vieja seguía viva. Pasó el 2026-11-10 en development.

**Si vuelve a pasar** (`max clients reached in session mode` en el build):

1. Revisa que `DATABASE_URL` sea la del 6543.
2. Suspende el servicio en Render (Settings → Suspend Web Service) para que la instancia vieja suelte las conexiones.
3. Reanúdalo y lanza **Manual Deploy → Deploy latest commit**.

La misma regla vale para los `.env.development` y `.env.production` locales. Un backend corriendo en tu máquina con el 5432 también ocupa cupos del modo sesión.

### Después de un despliegue con migraciones de legal

Si el despliegue aplica la migración del catálogo de documentos legales a un entorno sin documentos, **publícalos en seguida**. Mientras falten, el registro y la creación de negocios responden 503. Ver [legal](modulos/legal.md#del-borrador-al-texto-definitivo).

## Antes de fusionar a `master`

1. Comprueba qué migraciones se van a aplicar:
   ```bash
   npm run migrate:status:production
   ```
2. Revisa el SQL de cada migración pendiente. Si borra o renombra columnas, confirma que sigue el patrón expand/contract de [base-de-datos.md](base-de-datos.md#cambios-que-borran-o-renombran).
3. Confirma que esas migraciones ya se probaron en development.
4. Si el cambio necesita variables de entorno nuevas, agrégalas en Render **antes** del despliegue.
