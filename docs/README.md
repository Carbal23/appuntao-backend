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
| `auth` | Login, refresh token, logout, sesiones por dispositivo | [auth.md](modulos/auth.md) |
| `auth-log` | Registro de eventos de seguridad (logins, bloqueos, contraseñas, estado de la cuenta) | [auth-log.md](modulos/auth-log.md) (revisado) |
| `users` | Registro y gestión de usuarios | [users.md](modulos/users.md) |
| `business` | Negocios: creación, edición, cierre y reapertura | [business.md](modulos/business.md) (backend y app revisados) |
| `business-user` | Equipo del negocio y sus roles | [business-user.md](modulos/business-user.md) (backend y app revisados) |
| `debtors` | Deudores (clientes) de cada negocio | [debtors.md](modulos/debtors.md) (backend y app revisados) |
| `debts` | Deudas y su saldo | [debts.md](modulos/debts.md) (backend y app revisados) |
| `payments` | Pagos, abonos agrupados y reversos | [payments.md](modulos/payments.md) (backend y app revisados) |
| `invitations` | Invitaciones a clientes y miembros del equipo | [invitations.md](modulos/invitations.md) (backend y app entregados) |
| `audit` | Registro de auditoría de acciones | [audit.md](modulos/audit.md) (revisado) |
| `health` | Health check para el despliegue | [health.md](modulos/health.md) |
| `legal` | Documentos legales versionados (catálogo de tipos) y prueba de aceptación (Ley 1581) | [legal.md](modulos/legal.md) |
| `account-lifecycle` | Desactivar y eliminar la cuenta, transferir y exportar negocios, tarea diaria de retención | [account-lifecycle.md](modulos/account-lifecycle.md) |

## Cómo mantener la documentación

- Si cambias cómo funciona un módulo, actualiza su documento **en el mismo pull request**.
- Documenta el **por qué** de las decisiones; el qué ya está en el código.
- Si un documento contradice al código, manda el código: corrige el documento.
