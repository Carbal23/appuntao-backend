# Módulo `health`

**Código:** `src/health/`

## Propósito

Responde si el servidor está arriba. Render lo consulta para saber si el despliegue quedó bien y si el servicio sigue vivo (ver [despliegue](../despliegue.md)).

## Endpoint

| Método | Ruta | Autenticación | Respuesta |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Ninguna | `200 { "status": "ok" }` |

## Qué no hace

No revisa la base de datos ni el correo: responde `ok` mientras el proceso de Node esté corriendo. Si la base se cae, el health sigue en verde y las demás rutas responden 500.

## Decisiones y pendientes

- **Pendiente:** si hace falta que Render reinicie el servicio cuando se pierde la base, el health tendría que hacer una consulta simple (`SELECT 1`). Hoy no la hace.
