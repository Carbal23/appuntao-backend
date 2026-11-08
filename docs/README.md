# Documentación de APPUNTAO Backend

Índice de la documentación. El [README principal](../README.md) cubre solo lo necesario para levantar el proyecto; aquí está el detalle.

## General

| Documento | Contenido |
| --- | --- |
| [Arquitectura](arquitectura.md) | Estructura del proyecto, cómo se arma un módulo, autenticación, contexto de negocio, roles, paginación y convenciones |
| [Entornos y configuración](entornos-y-configuracion.md) | Archivos `.env`, variables de entorno y para qué sirve cada una |
| [Base de datos y migraciones](base-de-datos.md) | Modelos de Prisma, reglas y flujos de migración, qué hacer si algo sale mal |
| [Despliegue](despliegue.md) | Cómo se despliega en Render y cómo se aplican las migraciones |

## Módulos

Cada módulo tiene su documento con propósito, alcance, endpoints, reglas de negocio, flujos y decisiones. Para documentar uno nuevo, copia la [plantilla](_plantilla-modulo.md).

| Módulo | Qué hace | Documento |
| --- | --- | --- |
| `auth` | Login, refresh token, logout, sesiones por dispositivo | Pendiente |
| `auth-log` | Registro de eventos de seguridad (logins, bloqueos, logouts) | Pendiente |
| `users` | Registro y gestión de usuarios | Pendiente |
| `business` | Negocios: creación, edición, inactivación | Pendiente |
| `business-user` | Equipo del negocio y sus roles | Pendiente |
| `debtors` | Deudores (clientes) de cada negocio | Pendiente |
| `debts` | Deudas y su saldo | Pendiente |
| `payments` | Pagos, abonos agrupados y reversos | Pendiente |
| `invitations` | Invitaciones a deudores y miembros del equipo | Pendiente |
| `audit` | Registro de auditoría de acciones | Pendiente |
| `health` | Health check para el despliegue | Pendiente |

> Los módulos que todavía viven en otra rama (por ejemplo `account-lifecycle` o documentos legales) se documentan en esa rama, para que el documento llegue junto con su código.

## Cómo mantener la documentación

- Si cambias cómo funciona un módulo, actualiza su documento **en el mismo pull request**.
- Documenta el **por qué** de las decisiones; el qué ya está en el código.
- Si un documento contradice al código, manda el código: corrige el documento.
