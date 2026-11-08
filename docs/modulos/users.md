# Módulo `users`

**Código:** `src/users/`

## Propósito

Registro y gestión de las cuentas de usuario: crear la cuenta con su aceptación legal, consultar y editar los datos, cambiar la contraseña, buscar a una persona para agregarla a un negocio y armar el dashboard con los negocios del usuario.

## Alcance

**Hace:**
- Registro público con validación y normalización de datos, y registro de las aceptaciones legales en la misma transacción.
- Consulta y edición del propio usuario. Un `ADMIN` de plataforma puede ver y editar a cualquiera.
- Cambio de contraseña, que cierra todas las sesiones.
- Búsqueda exacta de un usuario por correo, teléfono o documento (`lookup`).
- Dashboard: negocios propios, negocios donde trabaja y negocios donde es cliente.
- Expone las rutas de ciclo de vida de la cuenta (`/users/me/deactivate`, `/users/me/deletion`, `/users/:id/inactivate`...). La lógica está en `account-lifecycle` ([account-lifecycle.md](account-lifecycle.md)).

**No hace:**
- Login ni sesiones: [`auth`](auth.md).
- Publicar o aceptar documentos legales después del registro: [`legal`](legal.md).
- Recuperar la contraseña olvidada: todavía no existe.

## Modelos

| Modelo | Uso en este módulo |
| --- | --- |
| `User` | La cuenta |
| `UserConsent` | Aceptaciones legales del registro (a través de `LegalService`) |
| `RefreshToken` | Se borran todos al cambiar la contraseña |
| `Business`, `BusinessUser`, `Debtor` | Lectura, para el dashboard |
| `AuthLog` | Eventos de cambio de contraseña |

## Datos del usuario

| Campo | Regla | Se guarda como |
| --- | --- | --- |
| `firstName`, `lastName` | Obligatorios, hasta 60 caracteres. Letras, espacios, apóstrofo, punto y guion | Sin espacios al inicio ni al final |
| `documentType` | `CC`, `NIT` o `FOREIGNER` | — |
| `documentNumber` | Obligatorio y único. CC: 6 a 10 dígitos. NIT: 9, o 10 con el dígito de verificación. Extranjería: 3 a 20 letras o números | CC y NIT solo dígitos (`1.032.876.361` → `1032876361`); extranjería en mayúsculas sin separadores |
| `email` | Opcional y único | En minúsculas |
| `phone` | Opcional y único. Celular (`3XXXXXXXXX`) o fijo (`60XXXXXXXX`) de Colombia | 10 dígitos, sin `+57` ni espacios |
| `password` | Mínimo 8 caracteres y máximo 72 bytes, con al menos una letra y un número | Hash bcrypt |
| `role` | El registro siempre crea `USER`. Solo un `ADMIN` puede cambiarlo | `USER` o `ADMIN` |

La normalización hace que el mismo correo o teléfono no quede registrado dos veces con distinta escritura, y que el login y el `lookup` los encuentren se escriban como se escriban.

La regla de contraseña aplica al registro y al cambio de contraseña, **no al login**, para que las cuentas creadas con la regla anterior sigan entrando.

Las respuestas nunca incluyen la contraseña ni los campos de estado interno: se usa `userSafeSelect` (`id`, nombres, correo, teléfono, rol, documento, fechas).

## Endpoints

| Método | Ruta | Acceso | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/api/users` | Público. 10 por hora por IP | Registrar un usuario |
| `GET` | `/api/users` | `ADMIN` | Listar usuarios activos |
| `GET` | `/api/users/lookup?identifier=` | Autenticado. 30 por minuto | Buscar un usuario por dato exacto. Devuelve solo `id`, `firstName`, `lastName` |
| `GET` | `/api/users/:id` | El propio usuario o `ADMIN` | Ver un usuario |
| `PATCH` | `/api/users/:id` | El propio usuario (solo nombres) o `ADMIN` (todo) | Editar un usuario |
| `PATCH` | `/api/users/me/password` | Autenticado | Cambiar la contraseña |
| `GET` | `/api/users/me/dashboard` | Autenticado | Negocios del usuario |
| `POST` | `/api/users/me/deactivate` | Autenticado | Desactivar la propia cuenta → `account-lifecycle` |
| `GET` | `/api/users/me/deletion-preview` | Autenticado | Qué pasará si elimina la cuenta → `account-lifecycle` |
| `POST` | `/api/users/me/deletion` | Autenticado | Solicitar la eliminación → `account-lifecycle` |
| `PATCH` | `/api/users/:id/inactivate` | `ADMIN` | Desactivar a un usuario → `account-lifecycle` |
| `PATCH` | `/api/users/:id/reactivate` | `ADMIN` | Reactivar a un usuario → `account-lifecycle` |

"Acceso `ADMIN`" se refiere al rol de **plataforma** (`User.role`), no al rol dentro de un negocio.

## Flujos

### Registro

1. El frontend obtiene los documentos legales vigentes con `GET /api/legal/current` y los muestra.
2. Envía `POST /api/users` con los datos y `acceptedLegalDocumentIds`: los ids de **todos** los documentos vigentes. Si falta alguno, se rechaza. Si no hay documentos vigentes publicados, responde 503.
3. Se comprueba que no exista otro usuario con el mismo correo, teléfono o documento:
   - si existe y está **desactivado**, el mensaje indica que inicie sesión para reactivarla o contacte a soporte;
   - si existe y está activo, se indica qué dato está repetido.
4. En una transacción se crea el usuario (rol `USER`) y sus aceptaciones (`UserConsent`, con IP y user agent).
5. El registro no inicia sesión: el frontend hace login a continuación.

### Edición

- El propio usuario solo puede cambiar `firstName` y `lastName`. Si envía correo, teléfono, documento o rol, responde 403.
- Un `ADMIN` puede cambiar todos esos campos.
- La contraseña no se cambia por aquí (va por `/me/password`), y las aceptaciones legales tampoco (van por `/legal/accept`).

### Cambio de contraseña

1. Exige la contraseña actual. Si no coincide, registra `PASSWORD_CHANGE_FAILED` y responde 400.
2. En una transacción guarda la nueva y **borra todos los refresh tokens** del usuario: se cierran las sesiones de todos los dispositivos, incluido el actual.
3. Registra `PASSWORD_CHANGED`.

El access token en uso sigue funcionando hasta que venza. Después, el usuario debe volver a iniciar sesión.

### Lookup

Pensado para agregar a una persona a un negocio sin exponer la lista de usuarios. Busca solo usuarios activos y no anonimizados, por coincidencia exacta (después de normalizar). Si el dato corresponde a más de una cuenta, responde 409 y pide buscar con otro dato.

### Dashboard

| Lista | Qué incluye |
| --- | --- |
| `ownedBusinesses` | Negocios de los que es dueño, **incluidos los inactivos** (traen `inactivatedAt`), porque el dueño todavía puede descargar su información |
| `workingBusinesses` | Negocios **activos** donde es miembro y no es el dueño, con su rol. El dueño también es miembro `OWNER` de su negocio; se excluye para no repetirlo |
| `clientBusinesses` | Registros de deudor vinculados a su cuenta, de negocios activos |

## Permisos y seguridad

- El registro tiene límite por IP (10 por hora) para evitar la creación masiva de cuentas y usar el registro para averiguar qué datos están registrados.
- `lookup` tiene límite de 30 por minuto y devuelve solo el nombre.
- Detrás de un proxy hace falta `TRUST_PROXY=1` para que los límites usen la IP real (ver [auth.md](auth.md#permisos-y-seguridad)).

## Integraciones

| Con | Para qué |
| --- | --- |
| `legal` | Validar que se aceptan todos los documentos vigentes y registrar las aceptaciones |
| `auth-log` | Registrar cambios de contraseña |
| `account-lifecycle` | Desactivación, eliminación y reactivación de cuentas |
| `auth` | Usa `userSafeSelect` y `serializeUser` de este módulo |

## Errores

| Código | Cuándo |
| --- | --- |
| 400 | Datos inválidos; correo, teléfono o documento ya registrados; contraseña actual incorrecta |
| 403 | Ver o editar a otro usuario sin ser `ADMIN`; editar campos reservados al `ADMIN` |
| 404 | Usuario no encontrado; `lookup` sin resultados |
| 409 | `lookup` con un dato que corresponde a más de una cuenta |
| 429 | Límite de registro o de `lookup` superado |
| 503 | Registro sin documentos legales vigentes publicados |

## Decisiones y pendientes

- **Decisión:** el usuario no puede cambiar su correo, teléfono ni documento. **Por qué (por confirmar):** son los datos con los que se le identifica, se le busca y se le invita; cambiarlos sin verificarlos permitiría quedarse con invitaciones dirigidas a otra persona.
- **Decisión:** el registro no acepta `role` y siempre crea `USER`. **Por qué:** el DTO anterior aceptaba `role` aunque el servicio lo ignoraba; ahora el contrato de la API refleja lo que de verdad pasa.
- **Pendiente (bug):** en `UsersService.create`, la búsqueda del usuario existente arma `OR: [{ email: data.email ?? undefined }, ...]`. Si el registro no trae correo (o teléfono), Prisma interpreta `{ email: undefined }` como `{}`, que coincide con **cualquier** usuario. Si ese usuario está desactivado, el registro falla con un falso "ya existe una cuenta... pero está desactivada". Si no, el duplicado real puede escaparse de la validación y terminar en el error genérico de campo único. Se corrige agregando al `OR` solo los datos que vienen.
- **Pendiente:** recuperación de contraseña.
- **Pendiente:** verificación de correo y teléfono.
