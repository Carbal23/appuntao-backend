# 💸 APPUNTAO Backend

Servidor principal de **APPUNTAO**, una aplicación para que los negocios lleven el control de sus **fiados**: deudores, deudas, pagos, equipo de trabajo e invitaciones, con trazabilidad de cada operación.

Construido con **NestJS**, **Prisma ORM** y **PostgreSQL** (local o en Supabase).

> 📚 **Documentación completa en [`docs/`](docs/README.md)**: arquitectura, entornos, base de datos y migraciones, despliegue y el funcionamiento de cada módulo.

---

## ⚙️ Stack

| Tecnología | Uso |
| --- | --- |
| **NestJS 11** | Framework, módulos e inyección de dependencias |
| **Prisma 6** | ORM, migraciones y cliente tipado |
| **PostgreSQL** | Base de datos (local, o Supabase en development y production) |
| **Passport + JWT + bcrypt** | Autenticación con access token y refresh token |
| **Resend** | Envío de correos (invitaciones) |
| **Swagger** | Documentación interactiva de la API (fuera de production) |

Requisitos: **Node.js 22** y **PostgreSQL** para el entorno local.

---

## 🚀 Arranque rápido (local)

```bash
git clone https://github.com/tu-repo/appuntao-backend.git
cd appuntao-backend
npm install
# 1. Crea una base vacía en tu PostgreSQL (por ejemplo appuntao_db)
# 2. Crea .env.local (ver docs/entornos-y-configuracion.md)
npm run migrate:local
npm run start:local
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs`
- Health check: `http://localhost:3000/api/health`

---

## 🧰 Scripts

| Script | Qué hace |
| --- | --- |
| `npm run start:local` | Levanta el servidor en modo watch con `.env.local` |
| `npm run start:dev` | Levanta el servidor en modo watch con `.env.development` |
| `npm run start:prod` | Ejecuta la versión compilada (`dist/`) |
| `npm run build` | Compila el proyecto |
| `npm run migrate:local` | Crea o aplica migraciones en tu base local |
| `npm run migrate:status:<entorno>` | Muestra las migraciones pendientes (`local`, `development`, `production`) |
| `npm run migrate:deploy:<entorno>` | Aplica las migraciones pendientes (`development`, `production`) |
| `npm run generate` | Regenera el cliente de Prisma |
| `npm run legal:publish:<entorno> -- ...` | Publica una versión de un documento legal ([detalle](docs/modulos/legal.md#publicar-una-versión-nueva)) |
| `npm run maintenance:run:<entorno>` | Ejecuta a mano la tarea diaria de cuentas; requiere `npm run build` antes ([detalle](docs/modulos/account-lifecycle.md#tarea-diaria)) |
| `npm run lint` / `npm run format` | ESLint y Prettier |
| `npm test` | Pruebas unitarias |

El detalle de cada script de migración y cuándo usarlo está en [docs/base-de-datos.md](docs/base-de-datos.md).

---

## 📁 Estructura

```
prisma/            schema.prisma y migraciones
src/
├── <modulo>/      un módulo de NestJS por dominio (auth, debts, payments, ...)
├── common/        decorators, paginación, DTOs y utilidades compartidas
├── config/        configuración tipada (app, database, jwt)
├── prisma/        PrismaService
└── providers/     integraciones externas (email)
scripts/           scripts de operación (publicar documentos legales)
docs/              documentación del proyecto
```

Ver [docs/arquitectura.md](docs/arquitectura.md).

---

## 🧑‍💻 Autor

**Equipo APPUNTAO**. Desarrollado por Mauricio Carbal.
