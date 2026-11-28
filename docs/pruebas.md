# Pruebas

Cómo se prueban el backend y qué falta. Sigue la convención de NestJS: Jest para todo, pruebas unitarias junto al código y pruebas de punta a punta (e2e) en `test/`. Las que necesitan Postgres de verdad corren contra una base de pruebas propia, `appuntao_test`.

## Los tres tipos de prueba

| | Unitarias | De punta a punta (e2e) | Con base real |
| --- | --- | --- | --- |
| Dónde | Junto al archivo que prueban: `src/<modulo>/<archivo>.spec.ts` | `test/<tema>.e2e-spec.ts` | `test/<modulo>.db-spec.ts` |
| Qué prueban | Una pieza sola: un service, un guard, una regla | Una petición HTTP con módulos sueltos | Peticiones HTTP a la aplicación completa (`AppModule`): guards, DTOs, transacciones, SQL |
| Base de datos | Nunca. `PrismaService` se reemplaza por un objeto de mentira (mock) | Mock | `appuntao_test` en el Postgres local, vaciada antes de cada prueba |
| Comando | `npm test` | `npm run test:e2e` | `npm run test:db` |
| Configuración | `jest` en `package.json` (`rootDir: src`) | `test/jest-e2e.json` | `test/jest-db.json` y `test/db/` |

**Cuándo usar cada una.** La unitaria es rápida y sirve para las reglas y para el orden de las consultas. La de base real hace falta cuando la regla depende de Postgres: los `FOR UPDATE`, los decimales (`Decimal(12, 2)`), los índices únicos, las consultas con `$queryRaw` y las peticiones simultáneas. Un mock no prueba nada de eso.

Las tres configuraciones traducen los imports `src/...` (`moduleNameMapper`), igual que `tsconfig.json`. Sin eso Jest no encontraba ningún módulo: esa era la razón de que `npm test` estuviera roto.

**Por qué junto al código.** Es lo que genera `nest g` y lo que espera la configuración de Jest. Al abrir un archivo se ve en seguida si tiene pruebas, y al moverlo o borrarlo se mueven sus pruebas. `tsconfig.build.json` excluye `**/*spec.ts` y `test/`: las pruebas no llegan a `dist/`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm test` | Corre todas las unitarias |
| `npm test -- payments` | Solo los archivos cuyo nombre contiene `payments` |
| `npm run test:watch` | Vuelve a correr las pruebas al guardar |
| `npm run test:cov` | Unitarias con cobertura, en `coverage/` (no va en Git). No cuenta DTOs, módulos, `main.ts` ni `maintenance.ts` |
| `npm run test:e2e` | Corre las e2e |
| `npm run test:db` | Corre las pruebas con base real (una a la vez, `--runInBand`). La primera vez crea `appuntao_test` |
| `npm run test:db -- -t "pago global"` | Solo las pruebas cuyo nombre contiene ese texto |

Antes de abrir un pull request: `npm test`, `npm run test:e2e`, `npm run test:db`, `npm run lint` y `npm run build`.

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

## Pruebas con base real

### La base de pruebas

- **Cuál es.** `appuntao_test`, en el mismo Postgres de `.env.local`: se toman el usuario, la clave, el host y el puerto, y solo cambia el nombre de la base. No hay que crear archivos ni variables nuevas.
- **Cómo se prepara.** Antes de correr, `test/db/global-setup.ts` crea la base si no existe y le aplica las migraciones pendientes (`prisma migrate deploy`), las mismas de development y production. Una migración nueva se aplica sola la próxima vez.
- **Cómo se limpia.** Cada prueba vacía todas las tablas (`TRUNCATE … CASCADE`, menos `_prisma_migrations`) y arma sus propios datos. Ninguna depende de otra ni del orden.
- **Otra base.** Con `TEST_DATABASE_URL` se usa otra, por ejemplo en CI.

**Nunca borra una base de verdad.** `test/db/test-env.ts` se niega a correr si:

- el nombre de la base no termina en `_test`;
- sin `TEST_DATABASE_URL`, `.env.local` apunta a un servidor que no es local.

Una `DATABASE_URL` puesta en la terminal se ignora siempre: se usa la de `.env.local`.

Las pruebas fijan `NODE_ENV=test`, apagan la verificación del correo y no mandan correos.

### Cómo se escribe

```ts
let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });   // AppModule + configureApp
afterAll(() => t.close());

it('baja el saldo y deja la deuda en PARTIAL', async () => {
  await resetDatabase(t.prisma);
  const owner = await createUser(t.prisma);
  const business = await createBusiness(t.prisma, owner.id);   // con el dueño como OWNER
  const debtor = await createDebtor(t.prisma, business.id);
  const debt = await createDebt(t.prisma, { businessId: business.id, debtorId: debtor.id, createdBy: owner.id, amount: 100 });

  const api = asMember(t.app, await t.tokenFor(owner), business.id);   // Bearer + x-business-id
  await api.post('/api/payments', { debtId: debt.id, amount: 30, method: 'CASH' }).expect(201);

  expect(await debtState(t.prisma, debt.id)).toEqual({ balance: '70.00', status: 'PARTIAL' });
});
```

| Archivo | Qué tiene |
| --- | --- |
| `test/db/test-app.ts` | `createTestApp()` (la aplicación completa, con un token como el del login), `resetDatabase()` y `asMember()` (`get`, `post`, `patch`) |
| `test/db/factories.ts` | `createUser`, `createBusiness`, `addMember`, `createDebtor`, `createDebt` y `debtState` (saldo como texto, `"70.00"`) |
| `test/db/test-env.ts` | Las variables y las barreras de arriba |
| `test/db/global-setup.ts` | Crea la base y aplica las migraciones |
| `test/db/schedule.stub.ts` | Reemplaza `@nestjs/schedule`. Desde la versión 12 el paquete es solo ESM y Jest no lo carga con Node 22. La aplicación sí lo carga, y en las pruebas la tarea diaria no debe correr |

`src/app.setup.ts` (`configureApp`) tiene el prefijo `/api` y el `ValidationPipe`. Lo usan `main.ts` y las pruebas, así que una prueba no pasa con una configuración distinta a la real.

### Peticiones simultáneas y bloqueos

Hay dos formas de probarlas, y hacen falta las dos:

- **Carreras.** Se mandan varias peticiones a la vez (`Promise.all`) y se revisa el resultado: cuántas entraron y que el saldo cuadre. Ojo: también pasan sin bloqueo cuando las peticiones son tan rápidas que no llegan a cruzarse. Se comprobó quitando el `FOR UPDATE`.
- **Bloqueo forzado.** Otra transacción bloquea la deuda y la cambia sin confirmar. La petición tiene que esperar y ver el cambio; sin `FOR UPDATE` leería el saldo viejo. Estas no dependen de la suerte: al quitar cualquiera de los bloqueos del service, falla su prueba.

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
| `src/debts/debts.service.spec.ts` | Margen de un día en el vencimiento; moneda del negocio; negocio abierto dentro de la transacción; `overdue` y `status` con AND; bloquear antes de anular |
| `src/payments/payments.service.spec.ts` | Recálculo del saldo y del estado; bloquear antes de leer; reparto del pago global; reverso: grupo, segunda mirada después del bloqueo, ids bloqueados en orden |
| `test/health.e2e-spec.ts` | Las dos rutas de health por HTTP, con el prefijo `/api` |
| `test/debts.db-spec.ts` | Debts contra la base: fiar (montos, vencimiento, cliente quitado, negocio cerrado, roles), listar y filtrar (vencidas, estado, búsqueda, orden, páginas sin repetir), anular (abonos o descuentos vigentes, reversados, estados no permitidos), anular y abonar a la vez, y bloqueos forzados (45 pruebas) |
| `test/payments.db-spec.ts` | Payments completo contra la base: abono, descuento, pago global y reversos, con roles, validación, negocio ajeno (404), centavos, auditoría, peticiones simultáneas y bloqueos forzados (47 pruebas) |

## Plan por módulos

Se avanza un módulo a la vez, en este orden: primero lo que mueve plata, después permisos y acceso. Cada módulo lleva sus unitarias (`src/<modulo>/*.spec.ts`) y, si depende de Postgres, su `test/<modulo>.db-spec.ts`, en una rama `test/<modulo>`.

| Orden | Módulo | Qué probar primero |
| --- | --- | --- |
| 1 | `payments` | **Hecho (2026-11-26).** Abono, descuento y pago global (reparto de la más antigua a la más nueva); no pasar del saldo; reversos (uno por movimiento, el grupo completo); recálculo del saldo y del estado |
| 2 | `debts` | **Hecho (2026-11-27).** Fiar (monto, vencimiento, deudor inactivo, negocio cerrado); anular solo una deuda `OPEN` sin abonos vigentes; filtros `overdue` y `status` |
| 3 | `debtors` | Duplicados por teléfono o documento; quitar solo sin saldo; vincular y desvincular; saldo total y ranking |
| 4 | `business-user` | Cambiar rol, sacar y salirse, con `team-rules` |
| 5 | `business` | Crear con documentos legales, editar, cerrar con deudas, reabrir hasta la fecha de borrado |
| 6 | `invitations` | Quién puede invitar, destinatario correcto, aceptar dos veces, vencidas |
| 7 | `auth` | Login (tiempo constante, cuenta inactiva, reactivar), rotación y reutilización del refresh token, recuperar la contraseña |
| 8 | `users` | Registro, edición (campos solo de ADMIN), cambiar la contraseña |
| 9 | `account-lifecycle` | Desactivar, eliminar, anonimizar, tarea diaria |
| 10 | `legal`, `audit`, `auth-log`, `common/validation` | Versiones vigentes y aceptación; normalización de correo, teléfono y documento |

## Pendientes

- **Pruebas con base real para los demás módulos**, siguiendo el plan.
- **Correr las pruebas en cada pull request** (GitHub Actions): `npm ci`, `npm run lint`, `npm test`, `npm run build`, y `npm run test:db` con un Postgres de servicio y `TEST_DATABASE_URL`.
