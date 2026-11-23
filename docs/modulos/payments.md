# Módulo `payments`

**Código:** `src/payments/`

> **Estado:** revisado en `feature/payments-review` el 2026-11-22. El backend se probó por script con 55 casos (ver [Qué se verificó](#qué-se-verificó)). Trae dos migraciones: `20261122180000_payment_reversal_link` y `20261122190000_payment_discount_type`. La app se ajustó en su rama `feature/payments-review`; falta probarla en el teléfono.

## Propósito

Registra **todo lo que mueve el saldo de una deuda después de fiarla**: los abonos del cliente, los descuentos que el negocio le hace y los reversos de movimientos mal registrados. Nada se edita ni se borra: un error se corrige con otro movimiento que lo compensa, y así el historial cuenta todo lo que pasó.

## Alcance

**Hace:**
- Abonar a una deuda, o al saldo total del cliente repartiéndolo entre sus deudas (pago global).
- Descontar: bajar el saldo sin que entre plata (lo que el negocio le perdona).
- Reversar un abono o un descuento suelto, o un pago global completo.
- Recalcular saldo y estado de la deuda después de cada movimiento.
- Listar los movimientos del negocio o de una deuda.

**No hace:**
- Fiar ni anular deudas (`debts`).
- Editar o borrar movimientos. Los borra `account-lifecycle` al purgar un negocio cerrado.

## Modelos

| Modelo | Uso en este módulo |
| --- | --- |
| `Payment` | Un movimiento: monto (siempre positivo), tipo, método, nota, quién lo hizo. `paymentGroupId` si es parte de un pago global; `reversedPaymentId` (único) si es un reverso |
| `PaymentGroup` | Un pago global: total, cliente, `reversedAt` cuando se reversa |
| `Debt` | Se bloquea, se valida y se le recalcula `balance` y `status` |
| `Debtor` | Para el pago global |
| `AuditLog` | Cada movimiento y cada recálculo, dentro de la misma transacción |

### Tipos de movimiento

| Tipo | En la app | Efecto en el saldo | Quién | Cómo se crea |
| --- | --- | --- | --- | --- |
| `PAYMENT` | Abono | Lo baja | Cualquier rol | `POST /payments` o `POST /payments/global` |
| `DISCOUNT` | Descuento | Lo baja | Dueño, administrador | `POST /payments/discounts`, con motivo |
| `REVERSAL` | Reverso | Lo sube en lo que había bajado el original | Dueño, administrador | Solo el backend, desde `POST /payments/:id/reverse` o `/payments/global/reverse/:groupId` |

```
saldo = monto fiado − abonos − descuentos + reversos      (nunca menor que 0)
estado = PAID si el saldo es 0 · OPEN si es igual al monto · PARTIAL en el medio
```

### Cómo se corrige cada error

| Error | Corrección |
| --- | --- |
| Se fió un valor equivocado, sin abonos | Anular la deuda (`debts`) y fiar el valor correcto |
| Se fió un valor equivocado, con abonos | Reversar los abonos, anular y fiar de nuevo |
| Se registró un abono equivocado | Reversar ese abono y registrar el correcto |
| Un pago global equivocado | Reversar el pago global completo |
| Se le perdona un saldo pequeño | Descuento, con motivo |
| Un descuento equivocado | Reversar el descuento |

## Endpoints

Todos exigen `Authorization: Bearer <token>`, `x-business-id` y ser miembro de ese negocio activo.

| Método | Ruta | Rol | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/api/payments` | `OWNER`, `ADMIN`, `CASHIER` | Abono a una deuda |
| `POST` | `/api/payments/global` | `OWNER`, `ADMIN`, `CASHIER` | Abono al saldo total del cliente |
| `POST` | `/api/payments/discounts` | `OWNER`, `ADMIN` | Descuento a una deuda |
| `POST` | `/api/payments/:id/reverse` | `OWNER`, `ADMIN` | Reversar un abono o un descuento suelto |
| `POST` | `/api/payments/global/reverse/:groupId` | `OWNER`, `ADMIN` | Reversar un pago global completo |
| `GET` | `/api/payments?page&limit&search&sortBy&order&type&method` | Cualquier miembro | Movimientos del negocio |
| `GET` | `/api/debts/:debtId/payments?…` | Cualquier miembro | Movimientos de una deuda. 404 si es de otro negocio |

### Body

| Endpoint | Campos |
| --- | --- |
| Abono | `debtId`; `amount`; `method` (`CASH`, `TRANSFER`, `OTHER`); `type` opcional y solo `PAYMENT` (la app lo manda); `note` opcional |
| Pago global | `debtorId`; `amount`; `method`; `note` opcional |
| Descuento | `debtId`; `amount`; `reason` obligatorio (3 a 200 caracteres), que queda como nota |
| Reverso suelto | `reason` opcional; queda en la nota ("Reverso de abono: …") |

`amount` es mayor que cero, con máximo dos decimales, hasta 9.999.999.999,99 y **nunca mayor que el saldo** (de la deuda, o el total del cliente en el pago global). Las notas se recortan, vacías quedan nulas y admiten 200 caracteres.

### Listar: filtros

`page`, `limit` (1 a 100); `search` en la nota; `sortBy`: `createdAt` (por defecto), `paymentDate` o `amount`; `order`: `asc` o `desc`; `type` y `method` con sus valores. Un valor fuera de la lista responde 400. El orden desempata por `id`.

### Qué se devuelve

Cada movimiento trae `id`, `amount` (texto decimal), `method`, `type`, `note`, `paymentDate`, `createdAt`, quién lo hizo (`id`, `firstName`, `lastName`), `paymentGroupId`, `reversedPaymentId` y `reversal` (`{ id, createdAt }` si ya fue reversado, `null` si no). Con eso la app sabe si ofrecer "Reversar". Los mismos campos llegan en los pagos embebidos de `GET /debtors/:id` y de los listados de deudas.

El pago global responde `{ message, group: { id, totalAmount }, debtor: { id, name }, summary: { totalApplied, debtsAffected }, payments: [{ paymentId, debtId, appliedAmount, previousBalance, newBalance, status }] }`.

## Reglas de negocio

- **Solo se mueve una deuda abierta.** Abonar o descontar a una deuda pagada o anulada responde 400.
- **El pago global va de la deuda más antigua a la más nueva** (FIFO por fecha de creación) y no puede pasar del saldo total.
- **Cada movimiento se reversa una sola vez y por su valor exacto.** El reverso queda enlazado al original con `reversedPaymentId`, que es único en la base: aunque dos personas lo intenten a la vez, solo pasa uno.
- **Un abono de un pago global no se reversa suelto**: responde 400 `PAYMENT_IN_GROUP` con el `paymentGroupId`, para reversar el grupo completo.
- **Un reverso no se reversa.** Si el reverso fue un error, se registra el abono de nuevo.
- **Anular una deuda** (`debts`) exige que no tenga abonos ni descuentos vigentes; los ya reversados no cuentan.

### Bloqueos y transacciones

Cada operación corre en una transacción que primero bloquea las filas de las deudas que toca (`SELECT … FOR UPDATE`, siempre en orden de `id`). Abonos, descuentos, reversos, pagos globales y la anulación de `debts` toman el mismo bloqueo, así que sobre una misma deuda se aplican de a uno, y el orden fijo evita que dos transacciones se traben entre sí. El saldo se recalcula desde todos los movimientos de la deuda, no sumando sobre el anterior.

El reverso de un pago global primero **reclama** el grupo (`UPDATE … SET reversedAt WHERE reversedAt IS NULL`): de dos reversos simultáneos, el segundo sale ahí sin crear nada.

## Flujos

### Abono

```mermaid
sequenceDiagram
    participant App
    participant API as POST /payments
    participant DB
    App->>API: debtId, amount, method, note?
    API->>API: Validar monto, método y nota (400)
    API->>DB: BEGIN; bloquear la deuda
    API->>DB: Deuda del negocio (404), abierta (400), saldo suficiente (400)
    API->>DB: Crear PAYMENT y auditoría PAYMENT_CREATED
    API->>DB: Recalcular saldo y estado; auditoría DEBT_STATUS_CHANGED
    API->>DB: COMMIT
    API-->>App: 201 con el movimiento
```

### Reverso de un movimiento suelto

```mermaid
sequenceDiagram
    participant App
    participant API as POST /payments/:id/reverse
    participant DB
    App->>API: reason?
    API->>API: Rol dueño o administrador (403)
    API->>DB: BEGIN; movimiento del negocio (404)
    alt Es un reverso, o es parte de un pago global
        API-->>App: 400 (PAYMENT_IN_GROUP trae el grupo)
    end
    API->>DB: Bloquear la deuda; ¿ya tiene reverso? (400)
    API->>DB: Crear REVERSAL con reversedPaymentId y auditoría PAYMENT_REVERSAL
    API->>DB: Recalcular saldo y estado; COMMIT
    API-->>App: 201 con el reverso
```

## Permisos y seguridad

- **Aislamiento por negocio.** Todo filtra por el `businessId` del header ya validado. Una deuda, un movimiento, un grupo o un cliente de otro negocio responden 404.
- **Roles.** Abonar: todos, porque el cajero cobra en el mostrador. Descontar y reversar: dueño y administrador, porque bajan o suben el saldo sin que entre plata. Es la misma regla que anular una deuda.
- **El cajero no puede mover el saldo hacia arriba.** Antes podía mandar `ADJUSTMENT` o `REVERSAL` y subir cualquier saldo sin límite.
- **Entrada.** `ValidationPipe` con `whitelist` y `forbidNonWhitelisted`; `sortBy`, `order`, `type` y `method` en lista cerrada.

## Auditoría

Todas se escriben **dentro de la transacción** (`AuditService.log(params, tx)`): si no se puede escribir la auditoría, el movimiento no queda, y una transacción que se revierte no deja filas.

| Acción | `entity` | Cuándo | `meta` |
| --- | --- | --- | --- |
| `PAYMENT_CREATED` | `Payment` | Abono | `amount`, `method`, `debtId`, `debtorId`, `businessId` |
| `PAYMENT_CREATED` | `PaymentGroup` | Pago global | `debtorId`, `totalAmount`, `method`, `paymentsCount`, `debtIds`, `businessId` |
| `PAYMENT_DISCOUNT` | `Payment` | Descuento | `amount`, `reason`, `debtId`, `debtorId`, `businessId` |
| `PAYMENT_REVERSAL` | `Payment` | Reverso suelto | `reversedPaymentId`, `reversedType`, `amount`, `reason`, `debtId`, `businessId` |
| `PAYMENT_REVERSAL` | `PaymentGroup` | Reverso de pago global | `reversedPayments`, `totalAmount`, `debtIds`, `businessId` |
| `DEBT_STATUS_CHANGED` | `Debt` | Cada recálculo | `previousBalance`, `newBalance`, `previousStatus`, `status`, `causeId` (el movimiento o el grupo que lo causó) |

En todas, `userId` es quien hizo la acción. Los intentos rechazados no dejan fila.

## Errores

| Código | Cuándo |
| --- | --- |
| 400 | Monto, método, nota o motivo inválidos; `type` distinto de `PAYMENT`; mayor al saldo; deuda pagada o anulada; cliente sin deudas pendientes; reversar algo ya reversado, un reverso o un abono de un pago global (`PAYMENT_IN_GROUP`); grupo ya reversado; filtros inválidos |
| 403 | No es miembro; el cajero intenta descontar o reversar |
| 404 | Deuda, movimiento, grupo o cliente inexistente o de otro negocio |

## Decisiones y pendientes

- **Decisión (2026-11-22):** nada se edita ni se borra; los errores se corrigen con movimientos que compensan. **Por qué:** era la idea original del módulo y es la práctica contable; el historial muestra el error y la corrección.
- **Decisión (2026-11-22):** el descuento (`DISCOUNT`, antes `ADJUSTMENT`) solo baja el saldo, lo hacen dueño y administrador y lleva motivo. **Por qué:** sirve para perdonar saldos pequeños sin registrar un abono falso. Para cobrar más se fía otra deuda. Originalmente el ajuste aceptaba montos negativos y positivos; una validación general de "monto mayor que cero" (commit `1851ada`, 2026-04-21) lo dejó en "solo sube", que no corregía nada y dejaba al cajero inflar saldos.
- **Decisión (2026-11-22):** `ADJUSTMENT` se renombró a `DISCOUNT` (enum, endpoint, DTO y auditoría `PAYMENT_DISCOUNT`). **Por qué:** el nombre decía "ajuste en cualquier dirección" y ya solo baja el saldo. La migración `20261122190000_payment_discount_type` renombra el valor del enum y pasa a positivo los ajustes viejos que bajaban el saldo (se guardaban en negativo), con el mismo efecto en el saldo. Si encuentra un ajuste positivo (que subía el saldo), se detiene para revisarlo a mano. Las auditorías viejas `PAYMENT_ADJUSTMENT` no se reescriben.
- **Decisión (2026-11-22):** los reversos solo los crea el backend, desde un movimiento concreto. **Por qué:** un `REVERSAL` a mano no apuntaba a nada; se podía reversar dos veces o por más de lo abonado.
- **Decisión (2026-11-22):** en development no había ajustes ni reversos (5 abonos y 4 pagos globales, ninguno reversado; consulta de solo lectura), así que cambiar el efecto del ajuste no toca datos existentes.

### En la app

Rama `feature/payments-review` desde `dev`:

- **Tipos:** `ADJUSTMENT` pasó a `DISCOUNT` ("Descuento"); el mapper sigue leyendo `ADJUSTMENT` por si queda en la caché. Cada pago trae `paymentGroupId`, `reversedPaymentId` y `reversalId`, y `paymentEffect` dice en un solo lugar si sube o baja el saldo y si ya fue reversado.
- **Totales:** "Total pagado" cuenta solo los abonos vigentes (antes sumaba también los reversados); los descuentos van aparte (`totalDiscount`) y no cuentan como plata recibida.
- **Extracto** (tendero y cliente): el descuento lleva icono de etiqueta y `−`; el reverso, flecha de deshacer y `+` en rojo; el abono o descuento reversado se ve atenuado, tachado y con "Reversado". Antes todo salía como "Pago en efectivo −X", incluso los reversos. Un abono de pago global dice "(repartido)". Tocar un pago abre la deuda a la que se aplicó.
- **Hoja de la deuda:** "Total abonado" y "Descuentos" vigentes; cada movimiento con su signo; para dueño y administrador, **"Hacer un descuento"** (hoja nueva `DiscountSheet`, con tope en el saldo y motivo obligatorio) y **"Reversar"** en cada abono o descuento vigente. En un abono de pago global el botón dice "Reversar pago global" y la confirmación dice en cuántas deudas se repartió.
- **Anular** ahora se ofrece cuando no quedan abonos ni descuentos vigentes, igual que el backend.
- Permisos: `payment:discount` y `payment:reverse`, solo dueño y administrador. `paymentApi.create` ya no manda `type`; nuevos `createDiscount`, `reverse` y `reverseGlobal`.

### Puntos de la revisión del 2026-11-22

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Cualquier rol podía mandar `ADJUSTMENT` o `REVERSAL` a `POST /payments` y subir el saldo sin límite, incluso de una deuda pagada | **Corregido**: ahí solo `PAYMENT` |
| 2 | El ajuste solo podía subir el saldo, no corregía nada | **Cambiado**: `DISCOUNT` (descuento) hacia abajo, dueño y administrador, con motivo |
| 3 | No había cómo reversar un abono suelto; el único reverso era del pago global | **Agregado**: `POST /payments/:id/reverse` |
| 4 | El reverso global guardaba el enlace con el original solo en la nota ("Reversal of …") | **Corregido**: `reversedPaymentId` único (migración nueva) |
| 5 | Una deuda, un grupo o un cliente de otro negocio respondían 400 "no pertenece", que confirma que existen | **Corregido**: 404 |
| 6 | El monto aceptaba cualquier número de decimales (Decimal(12, 2) los redondeaba en silencio) | **Corregido**: dos decimales y tope |
| 7 | La nota no tenía tope ni se recortaba | **Corregido**: 200 caracteres |
| 8 | `method` inválido en los listados respondía 500; `sortBy` y `order` sin validar | **Corregido**: 400 |
| 9 | `GET /debts/:id/payments` de una deuda ajena respondía 200 vacío | **Corregido**: 404 |
| 10 | `DEBT_STATUS_CHANGED` guardaba como saldo anterior el monto original | **Corregido**: el saldo real anterior, el estado anterior y la causa |
| 11 | Las auditorías se escribían fuera de la transacción: una transacción revertida podía dejar recálculos auditados que no pasaron, y un fallo de auditoría dejaba el movimiento sin rastro (por lectura del código) | **Corregido**: dentro de la transacción |
| 12 | El reverso global no bloqueaba las deudas: un abono simultáneo podía recalcular sobre un saldo viejo (por lectura del código; no se reprodujo) | **Corregido**: bloqueo en orden de `id` |
| 13 | El reverso global creaba los reversos antes de reclamar el grupo; el segundo de dos simultáneos los deshacía al fallar | **Mejorado**: primero reclama el grupo. Ya era seguro (se probó contra `develop`) |
| 14 | `type` era obligatorio y no tenía valor por defecto | **Cambiado**: opcional, solo `PAYMENT` |
| 15 | Anular en `debts` exigía cero pagos, así que una deuda con un abono ya reversado no se podía anular nunca | **Corregido en `debts`**: cuenta solo abonos y descuentos vigentes |

### Qué se verificó

Script por HTTP contra una base desechable con las 21 migraciones aplicadas. El código nuevo pasa los 55 casos, y la prueba de `debts` (48) sigue pasando. Contra `develop` (b6060c1) pasan 21: fallan los puntos 1, 5, 8, 9, 10 y la integridad de saldos (los `ADJUSTMENT` y `REVERSAL` a mano dejan saldos que no cuadran), y los endpoints nuevos no existen. Ahí no se midieron los abonos simultáneos (`develop` exige `type`) ni los recálculos de transacciones revertidas (no guardaba la causa).

- **Abonar:** el cajero abona; nota recortada; sin `type` pasa; `DISCOUNT` y `REVERSAL` como `type` de un abono 400 sin mover el saldo; monto cero, negativo, con tres decimales o mayor al saldo 400; nota de 201 y método inválido 400; deuda ajena 404; deuda saldada 400.
- **Descuento:** cajero 403; sin motivo o con 2 letras 400; mayor al saldo 400; el administrador descuenta 300 y la deuda queda pagada.
- **Reversar suelto:** cajero 403; ajeno 404; el dueño reversa con motivo y el saldo sube lo mismo; dos veces, o reversar un reverso, 400; reversar un descuento devuelve la deuda a `PARTIAL`; el detalle del cliente muestra el abono reversado; cinco reversos simultáneos del mismo abono dejan uno solo.
- **Anular después de reversar:** con el abono reversado la deuda se anula; con uno vigente no.
- **Pago global:** mayor al total 400; cliente ajeno 404; reparte de la más antigua a la más nueva; un abono del grupo no se reversa suelto (400 con el grupo); cajero 403 y ajeno 404; tres reversos simultáneos del grupo dejan uno solo con dos reversos enlazados; los saldos vuelven a como estaban.
- **Concurrencia:** cinco abonos de 2.000 a una deuda de 6.000 dejan pasar 3 y el saldo en 0; reverso global, abono y pago global a la vez sobre las mismas deudas.
- **Integridad:** en todas las deudas el saldo y el estado son monto − abonos − descuentos + reversos; ningún movimiento reversado dos veces.
- **Migración del descuento:** sobre una base con las migraciones anteriores, un ajuste de −10.000 (como la prueba de Postman de abril en la base local) queda como `DISCOUNT` de 10.000 y el saldo recalculado sigue en 0; con un ajuste positivo la migración se detiene sin cambiar nada.
- **Auditoría:** cada abono, descuento y reverso suelto tiene su fila con quién, monto y motivo; `DEBT_STATUS_CHANGED` con el saldo anterior real y la causa; un solo `PAYMENT_REVERSAL` del grupo pese a los intentos simultáneos; ningún recálculo auditado de una transacción revertida.
