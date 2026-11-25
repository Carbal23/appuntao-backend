# Módulo `health`

**Código:** `src/health/`

## Propósito

Dice si el servidor y la base de datos responden. Lo usan Render, para saber si un despliegue quedó bien, y el ping externo que evita que el servicio gratuito se duerma (ver [despliegue](../despliegue.md#mantener-despierto-el-servicio)).

## Endpoints

| Método | Ruta | Autenticación | Qué revisa | Respuesta |
| --- | --- | --- | --- | --- |
| `GET` | `/api/health` | Ninguna | Que el proceso de Node responda. No toca la base | `200 { "status": "ok" }` |
| `GET` | `/api/health/ready` | Ninguna | Que la base responda a un `SELECT 1` en menos de 3 segundos | `200 { "status": "ok", "database": "ok" }` o `503 { "status": "error", "database": "unavailable" }` |

## Cuál usar

| Quién | Ruta | Por qué |
| --- | --- | --- |
| **Health Check Path** de Render | `/api/health` | Si la base se cae, el servidor no tiene la culpa: reiniciarlo o dar por fallido un despliegue no lo arregla |
| **Ping externo** (cron-job.org o similar) | `/api/health/ready` | Despierta el servidor y además usa la base. Supabase pausa los proyectos gratuitos que pasan una semana sin actividad, y una caída de la base se nota en el monitor |

## Decisiones

- **Decisión:** dos rutas en lugar de una. **Por qué:** la de Render tiene que seguir en verde mientras el proceso esté vivo; la del ping tiene que decir si la API de verdad sirve.
- **Decisión:** `/health/ready` espera como mucho 3 segundos (`DB_CHECK_TIMEOUT_MS`). **Por qué:** con la base colgada, la petición quedaba esperando hasta que el cliente se cansara.
- La falla se registra en el log del servidor con `Logger.error`. Las respuestas no dicen por qué falló: la ruta es pública.
