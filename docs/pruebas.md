# Pruebas

Cómo se prueban el backend y qué falta. Sigue la convención de NestJS: Jest para todo, pruebas unitarias junto al código y pruebas de punta a punta (e2e) en `test/`.

## Los dos tipos de prueba

| | Unitarias | De punta a punta (e2e) |
| --- | --- | --- |
| Dónde | Junto al archivo que prueban: `src/<modulo>/<archivo>.spec.ts` | `test/<tema>.e2e-spec.ts` |
| Qué prueban | Una pieza sola: un service, un guard, una regla | Una petición HTTP completa: rutas, guards, `ValidationPipe`, respuesta |
| Base de datos | Nunca. `PrismaService` se reemplaza por un objeto de mentira (mock) | Hoy, mock. Más adelante, una base de pruebas propia (ver [pendientes](#pendientes)) |
| Comando | `npm test` | `npm run test:e2e` |
| Configuración | `jest` en `package.json` (`rootDir: src`) | `test/jest-e2e.json` (`rootDir: test`) |

Las dos configuraciones traducen los imports `src/...` (`moduleNameMapper`), igual que `tsconfig.json`. Sin eso Jest no encontraba ningún módulo: esa era la razón de que `npm test` estuviera roto.

**Por qué junto al código.** Es lo que genera `nest g` y lo que espera la configuración de Jest. Al abrir un archivo se ve en seguida si tiene pruebas, y al moverlo o borrarlo se mueven sus pruebas. `tsconfig.build.json` excluye `**/*spec.ts` y `test/`: las pruebas no llegan a `dist/`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm test` | Corre todas las unitarias |
| `npm test -- payments` | Solo los archivos cuyo nombre contiene `payments` |
| `npm run test:watch` | Vuelve a correr las pruebas al guardar |
| `npm run test:cov` | Unitarias con cobertura, en `coverage/` (no va en Git). No cuenta DTOs, módulos, `main.ts` ni `maintenance.ts` |
| `npm run test:e2e` | Corre las e2e |

Antes de abrir un pull request: `npm test`, `npm run test:e2e`, `npm run lint` y `npm run build`.

## Cómo se escribe una prueba unitaria

Un service se arma con `Test.createTestingModule` y cada dependencia se reemplaza con `useValue`. Así se prueba la lógica sin base de datos y cada prueba arranca de cero (`clearMocks` está activo).

```ts
const moduleRef = await Test.createTestingModule({
  providers: [
    BusinessOwnershipService,
    { provide: PrismaService, useValue: prisma },   // mock
    { provide: AuditService, useValue: { log: jest.fn() } },
  ],
}).compile();
const service = moduleRef.get(BusinessOwnershipService);
```

Para las transacciones, el mock de `$transaction` llama a la función con un `tx` de mentira:

```ts
const prisma = {
  $transaction: jest.fn((fn) => fn(tx)),
};
```

Las funciones sueltas (reglas como `canManageRole`) se prueban directamente, sin módulo.

### Convenciones

- **Un `describe` por clase o función, y uno por método.** Los nombres de las pruebas van en español y dicen la regla de negocio: `'respeta el tope de negocios activos de quien acepta'`, no `'should throw'`.
- **Se prueba lo que pide la regla, no la implementación.** Por ejemplo, que no se cambie el dueño cuando se llega al tope, no cuántas veces se llamó a cada método de Prisma. La excepción son las garantías que dependen del orden o de la cantidad de consultas: el bloqueo antes del conteo, la purga por lotes o una sola consulta en los guards.
- **Cada error de negocio tiene su prueba:** 400, 403, 404 y 409, con el mensaje cuando la app lo muestra.
- **Lo que se espera en el log no se imprime.** Si la prueba provoca un `Logger.error` a propósito, se silencia con `jest.spyOn(Logger.prototype, 'error').mockImplementation()`.
- **Los mocks guardan referencias propias** (`queryRaw`, `count`) en lugar de leer `prisma.$queryRaw`: así ESLint no marca `unbound-method`.
- **Un error que se corrige trae su prueba**, que falla sin el arreglo.

## Qué está probado hoy

| Archivo | Qué cubre |
| --- | --- |
| `src/providers/email.provider.spec.ts` | Los nombres que escriben los usuarios se escapan en el HTML de los correos |
| `src/business-user/team-rules.spec.ts` | Quién maneja a quién en el equipo |
| `src/business/business-cap.spec.ts` | Tope de 10 negocios activos: bloqueo del usuario y conteo |
| `src/business/business-ownership.service.spec.ts` | Aceptar una transferencia: cambio de dueño y tope |
| `src/auth/guards/business-guards.spec.ts` | `BusinessContextGuard` y `BusinessRoleGuard`: errores y una sola consulta por petición |
| `src/health/health.controller.spec.ts` | `/health` no consulta la base; `/health/ready` sí, con tiempo límite |
| `src/account-lifecycle/account-lifecycle.service.spec.ts` | La purga de un negocio cerrado: lotes, orden de borrado y lo que se conserva |
| `src/auth/one-time-code.spec.ts` | Códigos de 6 dígitos: HMAC, comparación y claves separadas por propósito |
| `src/auth/auth.service.spec.ts` | Login y refresh con el correo sin verificar: 403 `EMAIL_NOT_VERIFIED`, código enviado, sin tokens |
| `src/config/account.config.spec.ts` | La verificación del correo se exige siempre en production y es opcional en local y QA |
| `src/email-verification/email-verification.service.spec.ts` | Pedir y verificar el código: límites, intentos, mismo error para todo, correo cambiado |
| `src/invitations/invitations.service.spec.ts` | Aceptar desde `incoming` exige el código de la invitación |
| `test/health.e2e-spec.ts` | Las dos rutas de health por HTTP, con el prefijo `/api` |

## Plan por módulos

Se avanza un módulo a la vez, en este orden: primero lo que mueve plata, después permisos y acceso.

| Orden | Módulo | Qué probar primero |
| --- | --- | --- |
| 1 | `payments` | Abono, descuento y pago global (reparto de la más antigua a la más nueva); no pasar del saldo; reversos (uno por movimiento, el grupo completo); recálculo del saldo y del estado |
| 2 | `debts` | Fiar (monto, vencimiento, deudor inactivo, negocio cerrado); anular solo una deuda `OPEN` sin abonos vigentes; filtros `overdue` y `status` |
| 3 | `debtors` | Duplicados por teléfono o documento; quitar solo sin saldo; vincular y desvincular; saldo total y ranking |
| 4 | `business-user` | Cambiar rol, sacar y salirse, con `team-rules` |
| 5 | `business` | Crear con documentos legales, editar, cerrar con deudas, reabrir hasta la fecha de borrado |
| 6 | `invitations` | Quién puede invitar, destinatario correcto, aceptar dos veces, vencidas |
| 7 | `auth` | Login (tiempo constante, cuenta inactiva, reactivar), rotación y reutilización del refresh token, recuperar la contraseña |
| 8 | `users` | Registro, edición (campos solo de ADMIN), cambiar la contraseña |
| 9 | `account-lifecycle` | Desactivar, eliminar, anonimizar, tarea diaria |
| 10 | `legal`, `audit`, `auth-log`, `common/validation` | Versiones vigentes y aceptación; normalización de correo, teléfono y documento |

## Pendientes

- **E2e contra una base real.** Los mocks no prueban el SQL de verdad: los `FOR UPDATE`, las consultas con `$queryRaw` ni las restricciones únicas. Hace falta una base local propia para pruebas (por ejemplo `appuntao_test`), con las migraciones aplicadas y vaciada antes de cada archivo. Nunca la de development ni una compartida.
- **Correr las pruebas en cada pull request** (GitHub Actions): `npm ci`, `npm run lint`, `npm test`, `npm run build`.
