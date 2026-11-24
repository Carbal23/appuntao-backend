# Módulo `auth`

**Código:** `src/auth/`

## Propósito

Autentica a los usuarios y mantiene sus sesiones: emite el access token (JWT) y el refresh token, los renueva con rotación y cierra sesiones por dispositivo o en todos. También aporta los guards y decorators de autorización que usa el resto de módulos.

## Alcance

**Hace:**
- Login con correo, teléfono o número de documento.
- Una sesión por dispositivo, con refresh token rotativo y detección de reutilización.
- Logout del dispositivo actual o de todos.
- Bloqueo temporal tras varios intentos fallidos de login.
- Reactivar la cuenta desde el login, si la desactivó el propio usuario.
- Devolver en login y refresh los documentos legales pendientes de aceptar.
- Recuperar la contraseña olvidada con un código que llega al correo.
- Guards y decorators de autorización (ver [arquitectura.md](../arquitectura.md#autenticación-y-autorización)).

**No hace:**
- Registro de usuarios ni cambio de contraseña: está en [`users`](users.md).
- Desactivar o eliminar cuentas: está en `account-lifecycle` ([account-lifecycle.md](account-lifecycle.md)).
- Guardar los eventos de seguridad: lo hace `auth-log`, al que este módulo le reporta.
- Verificar el correo al registrarse: todavía no existe (ver [Decisiones y pendientes](#decisiones-y-pendientes)).

## Modelos

| Modelo | Uso en este módulo |
| --- | --- |
| `User` | Credenciales, rol de plataforma y estado de la cuenta |
| `RefreshToken` | Sesiones: hash del token, familia, dispositivo, vencimiento y rotación |
| `PasswordReset` | Códigos para recuperar la contraseña: HMAC del código, vencimiento, intentos fallidos y cuándo se usó |
| `AuthLog` | Eventos de seguridad (a través de `AuthLogService`) |

## Endpoints

Ninguno exige access token.

| Método | Ruta | Entrada | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Body: `identifier`, `password`, `deviceId`, `deviceName?`, `reactivate?` | Inicia sesión. Límite: 5 intentos por minuto por IP + identificador |
| `POST` | `/api/auth/refresh` | Headers: `x-refresh-token`, `x-device-id?` | Entrega tokens nuevos e invalida el refresh token usado |
| `POST` | `/api/auth/logout` | Header: `x-refresh-token`. Body: `allDevices?` | Cierra la sesión del dispositivo o, con `allDevices: true`, todas |
| `POST` | `/api/auth/password/forgot` | Body: `email` | Envía un código de 6 dígitos al correo, si es de una cuenta. Responde 200 igual exista o no |
| `POST` | `/api/auth/password/verify-code` | Body: `email`, `code` | Dice si el código sirve (`{ valid: true }`), sin cambiar nada. Cuenta como intento |
| `POST` | `/api/auth/password/reset` | Body: `email`, `code`, `newPassword` | Cambia la contraseña y cierra todas las sesiones. No inicia sesión |

Login y refresh responden lo mismo:

```json
{
  "user": { "id": "...", "firstName": "...", "role": "USER", "...": "..." },
  "accessToken": "eyJ...",
  "accessTokenExpiresIn": "1d",
  "refreshToken": "<userId>.<token>",
  "refreshTokenExpiresAt": "2026-12-08T00:00:00.000Z",
  "pendingLegalDocuments": [{ "id": "...", "type": "PRIVACY_POLICY", "version": "2026-10" }]
}
```

## Tokens y sesiones

| | Access token | Refresh token |
| --- | --- | --- |
| Formato | JWT firmado con `JWT_SECRET`; payload `{ sub, role }` | `<userId>.<128 caracteres hex aleatorios>` |
| Dónde se guarda en el servidor | No se guarda | Solo el **hash SHA-256** de la parte aleatoria, en `RefreshToken` |
| Duración | `JWT_EXPIRES_IN` (por defecto `1d`) | `REFRESH_TOKEN_EXPIRES_DAYS` (por defecto 30 días) |
| Cómo se envía | `Authorization: Bearer <token>` | Header `x-refresh-token` |

- **Una sesión por dispositivo.** El cliente genera un `deviceId` (UUID) la primera vez y lo envía siempre igual. Al hacer login se borran los refresh tokens anteriores de ese dispositivo y los vencidos del usuario.
- **Familia.** Cada login abre una familia (`familyId`). Las rotaciones de esa sesión pertenecen a la misma familia, y cerrar la sesión borra la familia completa.
- **El usuario se lee de la base en cada petición.** `JwtStrategy` no confía en el payload: busca al usuario por `sub` y, si está inactivado, responde 401. Por eso desactivar una cuenta corta el acceso de inmediato, aunque su access token no haya vencido, y `RolesGuard` usa el rol actual de la base, no el del token.

## Flujos

### Login

```mermaid
sequenceDiagram
    participant App
    participant API
    participant DB
    App->>API: POST /auth/login { identifier, password, deviceId }
    API->>API: LoginThrottlerGuard (5/min por IP + identificador)
    API->>DB: Buscar usuarios por correo, teléfono o documento (no anonimizados)
    API->>API: Comparar contraseña con bcrypt
    alt Sin coincidencia o más de una
        API->>DB: AuthLog LOGIN_FAILED
        API-->>App: 401
    else Cuenta no activa
        API-->>App: 403 ACCOUNT_DISABLED / ACCOUNT_DEACTIVATED / ACCOUNT_DELETION_PENDING
    else OK
        API->>DB: Borrar tokens del dispositivo y vencidos, crear RefreshToken
        API->>DB: AuthLog LOGIN_SUCCESS
        API-->>App: 201 tokens + pendingLegalDocuments
    end
```

1. El `identifier` se normaliza: `"Juan@Correo.com"`, `"+57 300 123 4567"` o `"1.032.876.361"` encuentran lo guardado como `juan@correo.com`, `3001234567` o `1032876361`.
2. Si la contraseña coincide con **más de una** cuenta (por ejemplo, el documento de una es el teléfono de otra), se rechaza y se pide entrar con otro dato.
3. El estado de la cuenta se revisa **después** de validar la contraseña, para no revelar el estado de una cuenta a quien no es su dueño:
   - `ACCOUNT_DISABLED`: la desactivó un administrador. No se puede reactivar desde el login.
   - `ACCOUNT_DEACTIVATED` o `ACCOUNT_DELETION_PENDING`: la desactivó el propio usuario. Si repite el login con `reactivate: true`, la cuenta se reactiva y se cancela la eliminación pendiente.
4. Si `pendingLegalDocuments` no viene vacío, el frontend debe mostrar esos documentos y registrar la aceptación (ver [legal.md](legal.md)).

### Refresh (rotación)

1. Se busca el token por su hash y se comprueba que pertenezca al `userId` del prefijo.
2. Se rechaza con 401 si no existe, venció o el `x-device-id` enviado no coincide con el del token.
3. **Si el token ya fue rotado** (alguien lo reutiliza):
   - dentro de los **30 segundos** siguientes a la rotación: 401 sin cerrar la sesión. Cubre el caso del frontend que lanza dos refresh a la vez con el mismo token;
   - después: se borra **toda la familia**, se registra `REFRESH_TOKEN_REUSED` y se responde 401 ("La sesión se cerró por seguridad"). Se asume que el token fue robado.
4. Si el usuario está inactivado: 401.
5. En una transacción, se marca el token como rotado (solo si nadie lo rotó antes), se borran los rotados anteriores de la familia y se emite uno nuevo en la misma familia.

El cliente **debe guardar el refresh token nuevo** en cada respuesta; el anterior deja de servir.

### Logout

- **Dispositivo actual:** borra la familia del token. Si el token no existe o ya no está activo, responde 200 igual (el resultado es el mismo: no hay sesión).
- **Todos los dispositivos** (`allDevices: true`): exige un token activo y borra todos los refresh tokens del usuario.

Los access tokens ya emitidos siguen siendo válidos hasta que venzan; el logout invalida la posibilidad de renovarlos.

### Recuperar la contraseña

Lo hace `PasswordResetService` ([password-reset.service.ts](../../src/auth/password-reset.service.ts)).

```mermaid
sequenceDiagram
    participant App
    participant API
    participant DB
    participant Resend
    App->>API: POST /auth/password/forgot { email }
    API-->>App: 200 "Si el correo está registrado, te enviamos un código"
    API->>DB: (en segundo plano) buscar cuenta, anular códigos anteriores, crear PasswordReset
    API->>Resend: correo con el código
    App->>API: POST /auth/password/verify-code { email, code }
    API-->>App: 200 { valid: true } o 400
    App->>API: POST /auth/password/reset { email, code, newPassword }
    API->>DB: transacción: usedAt, nueva contraseña, borrar RefreshToken
    API->>Resend: aviso "tu contraseña se cambió"
    API-->>App: 200, la app lleva al login
```

1. **Pedir el código** (`forgot`). Responde **de inmediato y siempre lo mismo**; el trabajo se hace después de responder. Así ni el mensaje ni el tiempo de respuesta delatan si el correo tiene cuenta. Solo se crea un código si:
   - hay una cuenta con ese correo que no está anonimizada;
   - la cuenta no la desactivó un administrador (`DISABLED`). Si la desactivó el propio usuario o pidió eliminarla, sí se puede: después del cambio, el login le ofrece reactivarla;
   - pasó al menos **1 minuto** desde el último código de esa cuenta;
   - la cuenta pidió menos de **5 códigos en 24 horas**. Al llegar al tope se registra `PASSWORD_RESET_BLOCKED` (`DAILY_LIMIT`).
2. **El código** tiene 6 dígitos (`crypto.randomInt`), vence a los **15 minutos** y se guarda como HMAC-SHA256 con una clave derivada de `JWT_SECRET`, nunca en claro. Pedir uno nuevo anula los anteriores: solo sirve el último que llegó.
3. **Comprobar el código** (`verify-code` y `reset`). Cada código admite **5 intentos fallidos**. El intento se descuenta antes de comparar, para que varias peticiones a la vez no se pasen del límite, y se devuelve si el código es correcto: pasar por `verify-code` y luego por `reset` no gasta intentos. Todos los fallos responden el mismo 400 ("El código no es válido o ya venció…"), sea código equivocado, vencido, agotado o correo sin cuenta.
4. **Cambiar la contraseña** (`reset`). `newPassword` sigue las mismas reglas que en el registro. En una transacción se marca el código como usado (solo una petición puede usarlo), se guarda la contraseña nueva y se borran **todos** los refresh tokens de la cuenta. Después se envía un aviso al correo. No devuelve tokens: la app lleva al login.

El código se escribe en la app; no hay enlace, porque no existe un frontend web. Los correos se mandan con Resend ([arquitectura](../arquitectura.md)). Si el envío falla, queda en el log del servidor y la respuesta no cambia.

## Permisos y seguridad

- Contraseñas con **bcrypt** (10 rondas). Los refresh tokens nunca se guardan en claro.
- **Límite de login:** 5 intentos por minuto por combinación IP + identificador. El identificador se normaliza antes de contar (`normalizeLoginIdentifier`): `300 123 4567`, `+57 3001234567` y `300-123-4567` son el mismo contador, igual que un correo en mayúsculas o un documento con puntos. Sin eso, el límite se esquivaba cambiando cómo se escribía el dato. Al bloquear se registra un único `LOGIN_BLOCKED` por ventana de bloqueo.
- **Mismo tiempo de respuesta exista o no la cuenta.** Si el identificador no corresponde a nadie, se compara la contraseña contra un hash de relleno con el mismo costo. Antes esa respuesta era más rápida y delataba qué correos, teléfonos o documentos están registrados.
- El contador del límite vive **en memoria** de cada instancia: se reinicia al reiniciar el servidor y no se comparte entre instancias.
- Detrás de un proxy (Render) hay que definir `TRUST_PROXY=1`. Sin eso, todas las peticiones parecen venir de la IP del proxy y el límite se aplica a todos los usuarios a la vez.
- `JWT_SECRET` debe tener al menos 32 caracteres o la aplicación no arranca. Cambiarlo anula también los códigos de recuperación vigentes, porque su clave sale de ahí.
- **Límite de recuperar la contraseña** (`PasswordResetThrottlerGuard`), por IP + correo normalizado: 3 solicitudes de código cada 15 minutos, y 10 intentos con código cada 15 minutos, contando juntos `verify-code` y `reset`. Al pasarse responde 429. Lo que no se esquiva cambiando de IP lo cuenta la base de datos: 5 intentos por código y 5 códigos al día por cuenta.

## Eventos que registra en `auth-log`

| Evento | Cuándo |
| --- | --- |
| `LOGIN_SUCCESS` | Login correcto |
| `LOGIN_FAILED` | Credenciales inválidas (`INVALID_CREDENTIALS`), identificador ambiguo (`AMBIGUOUS_IDENTIFIER`) o cuenta no activa (`ACCOUNT_*`) |
| `LOGIN_BLOCKED` | Se superó el límite de intentos |
| `REFRESH_TOKEN_REUSED` | Se reutilizó un refresh token ya rotado (fuera del margen de 30 s) |
| `LOGOUT` / `LOGOUT_ALL_DEVICES` | Cierre de sesión |
| `PASSWORD_RESET_REQUESTED` | Se creó y envió un código de recuperación |
| `PASSWORD_RESET_FAILED` | Código equivocado (`INVALID_CODE`), sin código vigente o correo sin cuenta (`NO_ACTIVE_CODE`), o código agotado (`TOO_MANY_ATTEMPTS`) |
| `PASSWORD_RESET_BLOCKED` | El código llegó a 5 fallos (`TOO_MANY_ATTEMPTS`) o la cuenta llegó a 5 códigos en 24 horas (`DAILY_LIMIT`) |
| `PASSWORD_RESET_COMPLETED` | Se cambió la contraseña con un código |

Lo que se escribió en `identifier` se guarda solo si corresponde a una cuenta, o si es un correo o solo dígitos; si no, queda como `(otro)`, para no guardar una contraseña escrita en el campo equivocado. Detalle en [auth-log](auth-log.md#qué-se-guarda-del-identificador). En los eventos `PASSWORD_RESET_*` el `identifier` es el correo.

## Integraciones

| Con | Para qué |
| --- | --- |
| `auth-log` | Registrar eventos de seguridad |
| `legal` | Calcular `pendingLegalDocuments` |
| `account-lifecycle` | Estado de la cuenta en el login y reactivación |
| `users` | `serializeUser` y `userSafeSelect`, para no devolver la contraseña ni estados internos |
| `EmailProvider` (Resend) | Código de recuperación y aviso de contraseña cambiada |
| `account-lifecycle` (tarea diaria) | Borra los `PasswordReset` de más de 7 días y los de una cuenta al anonimizarla |

## Errores

| Código | Cuándo |
| --- | --- |
| 400 | Falta `x-refresh-token` en refresh o logout; body inválido; código de recuperación inválido, vencido o agotado |
| 401 | Credenciales inválidas, identificador ambiguo, refresh token inválido, vencido, de otro dispositivo o reutilizado; usuario inactivado |
| 403 | Cuenta no activa: `ACCOUNT_DISABLED`, `ACCOUNT_DEACTIVATED`, `ACCOUNT_DELETION_PENDING` (este último incluye `deletionScheduledAt`) |
| 429 | Demasiados intentos de login o de recuperar la contraseña |

## Decisiones y pendientes

- **Decisión:** el refresh token lleva el `userId` como prefijo. **Por qué:** permite comprobar que el token pertenece a ese usuario sin depender solo del hash.
- **Decisión:** margen de 30 s para la reutilización. **Por qué:** sin él, dos refresh simultáneos del mismo cliente cerraban la sesión como si fuera un robo.
- **Decisión:** el estado de la cuenta se informa solo con la contraseña correcta. **Por qué:** no revelar si una cuenta existe o está desactivada.
- **Decisión (2026-11-24):** recuperar la contraseña con un **código de 6 dígitos al correo**, no con un enlace. **Por qué:** no hay frontend web donde abrir un enlace, y el código encaja con las invitaciones, que ya funcionan así.
- **Decisión:** solo por correo, no por teléfono ni documento. **Por qué:** el correo es obligatorio al registrarse y es a donde se envía. Aceptar otro dato obligaba a mostrar el correo enmascarado. No hay SMS: no existe proveedor. Una cuenta sin correo tiene que pasar por soporte.
- **Decisión:** `forgot` responde antes de hacer el trabajo, y `reset` no inicia sesión. **Por qué:** lo primero evita que el tiempo de respuesta delate qué correos tienen cuenta; lo segundo deja una sola forma de entrar (el login), que ya revisa el estado de la cuenta y los documentos legales.
- **Decisión:** la clave del HMAC del código sale de `JWT_SECRET`. **Por qué:** es una variable menos que configurar en cada entorno, y sin la clave una copia de la base no basta para probar el millón de códigos posibles.
- **Pendiente (riesgo aceptado para el MVP):** el correo **no se verifica** al registrarse. Si alguien se registró con un correo ajeno, el dueño real de ese correo puede quedarse con la cuenta usando la recuperación. La solución es verificar el correo al registrarse (o al cambiarlo).
- **Pendiente:** si el remitente es `onboarding@resend.dev` (el de prueba de Resend), los correos solo llegan al dueño de la cuenta de Resend. Para que la recuperación funcione con usuarios reales, `EMAIL_FROM` debe usar un dominio verificado.
- **Pendiente:** el límite es por IP + identificador; no hay bloqueo por cuenta. Alguien con muchas IP podría probar contraseñas de una misma cuenta. Para el MVP se acepta.
- **Decisión (2026-11-22):** `JWT_EXPIRES_IN` es `1d` en development, a propósito: el backend corre en el plan gratuito de Render y así la app hace menos renovaciones. **En production debe ser de 15 a 30 minutos** (`15m` o `30m`), para que un token robado, una sesión cerrada o una contraseña cambiada dejen de servir pronto. Revisarlo al configurar el entorno de production (ver [despliegue.md](../despliegue.md)).
- **Pendiente:** si se despliegan varias instancias, mover el almacenamiento del límite de login a un store compartido (por ejemplo Redis).
