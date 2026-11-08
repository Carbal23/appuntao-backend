# Módulo `legal`

**Código:** `src/legal/` · **Script:** `scripts/publish-legal-document.js`

> **Documento parcial:** contenido trasladado del README. Falta completarlo con la plantilla (endpoints detallados, errores, decisiones).

## Propósito

Cumplir la **Ley 1581 de 2012**: para registrarse, el usuario debe aceptar los **términos y condiciones** y la **política de tratamiento de datos**, y la ley exige conservar la prueba de esa autorización.

## Modelos

| Modelo | Qué guarda |
| --- | --- |
| `LegalDocument` | Cada versión de cada documento, con su texto completo y su huella SHA-256. Una versión publicada **no se modifica**: si el texto cambia, se publica una versión nueva. La vigente de cada tipo es la más reciente con `publishedAt` ya cumplida |
| `UserConsent` | Qué versión aceptó cada usuario, cuándo, desde qué IP y con qué navegador o app. Solo se agregan filas. `revokedAt` marca que el usuario retiró la autorización (eliminó su cuenta) |

Tipos (`LegalDocumentType`): `TERMS_AND_CONDITIONS`, `PRIVACY_POLICY`.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
| --- | --- | --- | --- |
| `GET` | `/api/legal/current` | Público | Textos vigentes |
| `GET` | `/api/legal/pending` | Autenticado | Documentos vigentes que el usuario no ha aceptado |
| `POST` | `/api/legal/accept` | Autenticado | Registrar la aceptación |

## Flujo

1. El frontend obtiene los textos vigentes con `GET /api/legal/current` (público) y los muestra.
2. En el registro (`POST /api/users`) envía `acceptedLegalDocumentIds` con los ids de **todos** los documentos vigentes. El usuario y sus aceptaciones se crean en una sola transacción (ver [users.md](users.md#registro)).
3. Login y refresh devuelven `pendingLegalDocuments`. Si no está vacío (por ejemplo, porque se publicó una versión nueva), el frontend muestra esos documentos (`GET /api/legal/pending`) y registra la aceptación con `POST /api/legal/accept`.

## Publicar una versión nueva

Los textos se guardan en el repositorio, en `legal/terms-and-conditions/<version>.md` y `legal/privacy-policy/<version>.md`, y se cargan en cada base con:

```bash
npm run legal:publish:local -- --type PRIVACY_POLICY --version 2026-10 --file legal/privacy-policy/2026-10.md --url https://appuntao.co/privacidad
```

- `--type`: `TERMS_AND_CONDITIONS` o `PRIVACY_POLICY`.
- `--url` (opcional): página pública donde también está publicado el texto.
- `--published-at` (opcional): fecha desde la que rige; por defecto, ahora.

El mismo comando existe para `development` y `production` (`legal:publish:development`, `legal:publish:production`). Publicar dos veces la misma versión con el mismo texto no hace nada; con un texto distinto, falla.

> ⚠️ Sin documentos vigentes publicados, el registro responde 503. Al preparar un entorno nuevo, publica ambos documentos antes de abrir el registro.

## Pendientes

- La carpeta `legal/` con los textos todavía no está en el repositorio.
- Confirmar el dominio real de `--url` (el ejemplo usa `appuntao.co`).
