# Spec Delta

## Purpose

Define las convenciones transversales que toda operación HTTP de `finance-api` cumple: versionado en la ruta, errores RFC 9457 con códigos de dominio estables, idempotencia de los POST financieros, concurrencia optimista con ETag/If-Match, paginación por cursor, representación de montos como string decimal con moneda y distinción entre fechas de negocio e instantes.

## ADDED Requirements

### Requirement: Versionado de la API en la ruta
Toda operación de negocio DEBE (MUST) exponerse bajo el prefijo de versión mayor `/api/v1`; una ruta con una versión no publicada DEBE (MUST) responder 404 en formato Problem Details sin ejecutar ninguna operación.
Trace: NFR-MAINT-009 · Priority: Must

#### Scenario: Operación bajo la versión publicada
- **CUANDO** un cliente autenticado llama a `GET /api/v1/me`
- **ENTONCES** la respuesta es 200

#### Scenario: Versión no publicada
- **CUANDO** un cliente autenticado llama a `GET /api/v2/me`
- **ENTONCES** la respuesta es 404 `application/problem+json` con código `RESOURCE_NOT_FOUND`

### Requirement: Detección de cambios incompatibles del contrato
El quality gate DEBE (MUST) comparar el contrato OpenAPI de la pull request con el de la rama principal y DEBE (MUST) fallar ante un cambio incompatible en `/api/v1` (quitar o renombrar campos, cambiar tipos o códigos de estado, volver obligatorio un campo) que no esté acompañado de una nueva versión o de una excepción registrada en un ADR.
Trace: NFR-MAINT-009 · Priority: Must

#### Scenario: Campo eliminado de una respuesta
- **CUANDO** una pull request elimina el campo `baseCurrency` de la respuesta de workspace en `/api/v1`
- **ENTONCES** el quality gate falla indicando el cambio incompatible

#### Scenario: Campo opcional agregado
- **CUANDO** una pull request agrega un campo opcional a una respuesta en `/api/v1`
- **ENTONCES** el chequeo de compatibilidad pasa

### Requirement: Deprecación anunciada con cabeceras
Una operación marcada como deprecada DEBE (MUST) responder con las cabeceras `Deprecation`, `Sunset` y un `Link` con `rel="deprecation"`, y su fecha de retiro DEBE (MUST) estar al menos 90 días después del anuncio.
Trace: NFR-MAINT-009 · Priority: Should

#### Scenario: Llamada a una operación deprecada
- **CUANDO** se llama a una operación deprecada el 2026-10-02
- **ENTONCES** la respuesta incluye `Deprecation`, `Sunset` con una fecha igual o posterior al 2026-12-31 y `Link` con `rel="deprecation"`

### Requirement: Errores en formato Problem Details
Toda respuesta de error 4xx y 5xx DEBE (MUST) usar `application/problem+json` (RFC 9457) con `type` URI estable, `title`, `status`, `code` de dominio y `requestId`; las validaciones por campo DEBEN (MUST) listarse en `errors[]` con JSON Pointer. NO DEBE (MUST NOT) incluir stack traces, SQL ni datos de otro workspace.
Trace: NFR-SEC-009, NFR-USAB-009 · Priority: Must

#### Scenario: Error de validación por campo
- **CUANDO** un cliente registra un gasto cuyo split tiene el monto "75.001" en BOB
- **ENTONCES** la respuesta es 422 `application/problem+json` con código `AMOUNT_SCALE_EXCEEDED`, `requestId` y un elemento de `errors[]` cuyo `pointer` es `/splits/0/amount`

#### Scenario: Error inesperado del servidor
- **CUANDO** una operación falla por una excepción no controlada
- **ENTONCES** la respuesta es 500 `application/problem+json` con código `INTERNAL_ERROR` y un `requestId` presente en los logs
- **Y** el cuerpo no contiene stack trace, SQL ni nombres de tablas

### Requirement: Catálogo estable de códigos de error
Todo `code` de error que la API pueda devolver DEBE (MUST) pertenecer al catálogo de códigos del contrato, mantener su significado y su estado HTTP entre versiones compatibles y tener un mensaje en español en el catálogo de la interfaz; la interfaz DEBE (MUST) mostrar ese mensaje y no el `title` técnico.
Trace: NFR-USAB-009, NFR-MAINT-009 · Priority: Must

#### Scenario: Código sin mensaje en español
- **CUANDO** se agrega al catálogo un código de error sin mensaje en el catálogo de español de la interfaz
- **ENTONCES** el test de catálogo de errores falla indicando el código

#### Scenario: La interfaz traduce por código
- **CUANDO** la API responde 409 con código `PERIOD_CLOSED`
- **ENTONCES** la interfaz muestra el mensaje en español asociado a `PERIOD_CLOSED`

### Requirement: Validación de peticiones contra el contrato
Toda petición DEBE (MUST) validarse contra el schema de su operación antes de llegar al caso de uso; campos desconocidos, tipos incorrectos o campos obligatorios ausentes DEBEN (MUST) rechazarse con 400 y código `VALIDATION_FAILED`, sin efectos.
Trace: NFR-SEC-009 · Priority: Must

#### Scenario: Campo desconocido en el cuerpo
- **CUANDO** un cliente crea un workspace enviando el campo adicional `ownerId`
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED` y un elemento de `errors[]` que señala `/ownerId`
- **Y** no se crea ningún workspace

### Requirement: Montos como string decimal con moneda
Todo monto en peticiones y respuestas DEBE (MUST) representarse como objeto con `amount` string decimal y `currency`; un `amount` enviado como número JSON DEBE (MUST) rechazarse con 400 y código `VALIDATION_FAILED`, y las respuestas DEBEN (MUST) usar siempre la escala canónica de la moneda.
Trace: NFR-DATA-001, NFR-DATA-010 · Priority: Must

#### Scenario: Escala canónica en la respuesta
- **CUANDO** un cliente define la reserva mínima de liquidez enviando `{"amount": "1500", "currency": "BOB"}`
- **ENTONCES** la respuesta devuelve `{"amount": "1500.00", "currency": "BOB"}`

#### Scenario: Escala de criptomoneda preservada
- **CUANDO** la API devuelve una conversión de 100.000000 USDT a 685.00 BOB
- **ENTONCES** los montos aparecen como `"100.000000"` con moneda USDT y `"685.00"` con moneda BOB, ambos como strings

#### Scenario: Monto enviado como número
- **CUANDO** un cliente envía `{"amount": 75.5, "currency": "BOB"}`
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED` y no se persiste nada

### Requirement: Rechazo de montos con escala excesiva
Un monto con más decimales que la escala de su moneda DEBE (MUST) rechazarse con 422 y código `AMOUNT_SCALE_EXCEEDED`; el sistema NO DEBE (MUST NOT) redondearlo ni truncarlo en silencio.
Trace: NFR-DATA-001, NFR-DATA-002 · Priority: Must

#### Scenario: USDT con siete decimales
- **CUANDO** un cliente envía un monto de 100.0000001 USDT, cuya escala es 6
- **ENTONCES** la respuesta es 422 con código `AMOUNT_SCALE_EXCEEDED` y no se persiste nada

#### Scenario: BOB con tres decimales
- **CUANDO** un cliente envía un monto de 685.005 BOB, cuya escala es 2
- **ENTONCES** la respuesta es 422 con código `AMOUNT_SCALE_EXCEEDED` y no se persiste un monto redondeado a 685.00 BOB ni a 685.01 BOB

### Requirement: Fechas de negocio frente a instantes
Las fechas de negocio DEBEN (MUST) intercambiarse como `YYYY-MM-DD` interpretadas en la zona horaria del workspace, y los instantes como RFC 3339 en UTC con sufijo `Z`; el sistema NO DEBE (MUST NOT) convertir una fecha de negocio a otra zona horaria.
Trace: NFR-USAB-004, NFR-DATA-011 · Priority: Must

#### Scenario: Gasto registrado cerca de medianoche en La Paz
- **CUANDO** el 2026-09-30 a las 23:30 hora de America/La_Paz se registra un gasto de 75.00 BOB con fecha de negocio 2026-09-30
- **ENTONCES** la respuesta devuelve la fecha de negocio `"2026-09-30"`
- **Y** el instante de creación se devuelve como `"2026-10-01T03:30:00Z"` (con la precisión de milisegundos que corresponda)

#### Scenario: Fecha de negocio con hora
- **CUANDO** un cliente envía como fecha de negocio `"2026-09-30T23:30:00-04:00"`
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED`

### Requirement: Idempotency-Key obligatoria en POST financieros
Todo POST que crea registros financieros o ejecuta acciones financieras DEBE (MUST) exigir la cabecera `Idempotency-Key` (16 a 128 caracteres `[A-Za-z0-9_-]`); si falta DEBE (MUST) responder 428 con código `IDEMPOTENCY_KEY_REQUIRED` sin ejecutar el comando.
Trace: FR-TRANSACTIONS-010, NFR-REL-007 · Priority: Must

#### Scenario: POST financiero sin clave
- **CUANDO** un EDITOR registra un gasto de 75.00 BOB sin cabecera `Idempotency-Key`
- **ENTONCES** la respuesta es 428 con código `IDEMPOTENCY_KEY_REQUIRED`
- **Y** no se crea ninguna transacción, asiento, registro de auditoría ni evento

#### Scenario: Clave con formato inválido
- **CUANDO** un EDITOR envía la cabecera `Idempotency-Key` con el valor "abc"
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED` y no se ejecuta el comando

### Requirement: Reproducción idempotente de POST financieros
Un POST repetido con la misma `Idempotency-Key` y el mismo payload dentro del periodo de retención DEBE (MUST) devolver la respuesta almacenada (mismo estado, cuerpo y cabeceras `Location`/`ETag`) con la cabecera `Idempotent-Replayed: true`, sin volver a ejecutar el comando ni producir efectos adicionales.
Trace: FR-TRANSACTIONS-010, NFR-REL-007 · Priority: Must

#### Scenario: Reintento de un gasto ya registrado
- **CUANDO** un EDITOR registra un gasto de 75.00 BOB con la clave "0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e01" y luego repite la misma petición con la misma clave
- **ENTONCES** ambas respuestas son 201 con el mismo identificador de transacción y la segunda incluye `Idempotent-Replayed: true`
- **Y** existe una sola transacción, un solo asiento, un solo registro de auditoría y un solo evento para ese gasto
- **Y** el saldo de la cuenta disminuye una sola vez en 75.00 BOB

### Requirement: Rechazo de Idempotency-Key reutilizada con otro payload
Un POST con una `Idempotency-Key` ya usada en el mismo ámbito (workspace, o usuario en operaciones sin workspace) pero con un payload distinto DEBE (MUST) rechazarse con 422 y código `IDEMPOTENCY_KEY_REUSED`, sin ejecutar el comando.
Trace: FR-TRANSACTIONS-010, NFR-REL-007 · Priority: Must

#### Scenario: Misma clave, monto distinto
- **CUANDO** un EDITOR registra un gasto de 75.00 BOB con la clave "K-0001-0001-0001" y luego envía un gasto de 80.00 BOB con la misma clave
- **ENTONCES** la segunda respuesta es 422 con código `IDEMPOTENCY_KEY_REUSED`
- **Y** solo existe el gasto de 75.00 BOB

### Requirement: Peticiones idempotentes concurrentes
Mientras la primera ejecución de una `Idempotency-Key` sigue en curso, otra petición con la misma clave DEBE (MUST) responder 409 con código `IDEMPOTENCY_REQUEST_IN_PROGRESS` y cabecera `Retry-After`, y el comando DEBE (MUST) producir efectos exactamente una vez.
Trace: FR-TRANSACTIONS-010, NFR-REL-007 · Priority: Must

#### Scenario: Doble clic que envía dos peticiones simultáneas
- **CUANDO** se envían simultáneamente dos peticiones idénticas para registrar un gasto de 75.00 BOB con la misma clave nueva
- **ENTONCES** una respuesta es 201 y la otra es 201 con `Idempotent-Replayed: true` o 409 con código `IDEMPOTENCY_REQUEST_IN_PROGRESS` y `Retry-After`
- **Y** existe exactamente una transacción de 75.00 BOB

### Requirement: Errores transitorios no consumen la clave de idempotencia
Las respuestas 5xx y 429 NO DEBEN (MUST NOT) almacenarse como resultado de una `Idempotency-Key`: un reintento con la misma clave y el mismo payload DEBE (MUST) volver a ejecutar el comando. Las respuestas 2xx y los rechazos 4xx deterministas sí DEBEN (MUST) almacenarse.
Trace: NFR-REL-007, NFR-REL-010 · Priority: Must

#### Scenario: Reintento tras indisponibilidad
- **CUANDO** un gasto de 75.00 BOB con la clave "K-0002-0002-0002" falla con 503 porque la base de datos no está disponible y luego se reintenta con la misma clave cuando ya está disponible
- **ENTONCES** el reintento responde 201 sin `Idempotent-Replayed`
- **Y** existe exactamente una transacción de 75.00 BOB

#### Scenario: Rechazo de dominio reproducido
- **CUANDO** un gasto de 685.005 BOB con la clave "K-0003-0003-0003" se rechaza con 422 `AMOUNT_SCALE_EXCEEDED` y se reintenta igual con la misma clave
- **ENTONCES** el reintento devuelve el mismo 422 con `Idempotent-Replayed: true`

### Requirement: Retención limitada de claves de idempotencia
Las claves de idempotencia DEBEN (MUST) conservarse al menos 24 h (configurable hasta 7 días); vencida la retención, la misma clave DEBE (MUST) tratarse como nueva.
Trace: NFR-REL-007 · Priority: Should

#### Scenario: Clave vencida
- **CUANDO** se reutiliza la clave de un gasto de 75.00 BOB registrado hace 25 h con retención configurada en 24 h
- **ENTONCES** la petición se procesa como nueva y crea otra transacción de 75.00 BOB

### Requirement: ETag en recursos versionados
Toda lectura de un agregado versionado DEBE (MUST) devolver la cabecera `ETag` fuerte derivada de su versión, y una lectura con `If-None-Match` igual a la versión vigente DEBE (MUST) responder 304 sin cuerpo.
Trace: FR-TRANSACTIONS-011, NFR-DATA-014 · Priority: Must

#### Scenario: Lectura con versión vigente
- **CUANDO** un cliente lee un workspace en versión 3 y vuelve a leerlo con `If-None-Match: "3"`
- **ENTONCES** la primera respuesta incluye `ETag: "3"` y la segunda es 304 sin cuerpo

### Requirement: If-Match obligatorio en modificaciones
Toda modificación o acción sobre un agregado existente DEBE (MUST) exigir la cabecera `If-Match`; si falta DEBE (MUST) responder 428 con código `PRECONDITION_REQUIRED` sin aplicar cambios.
Trace: FR-TRANSACTIONS-011, NFR-DATA-014 · Priority: Must

#### Scenario: Modificación sin If-Match
- **CUANDO** un OWNER cambia el nombre de su workspace sin cabecera `If-Match`
- **ENTONCES** la respuesta es 428 con código `PRECONDITION_REQUIRED` y el nombre no cambia

### Requirement: Rechazo de modificaciones sobre una versión obsoleta
Una modificación con `If-Match` distinto de la versión vigente DEBE (MUST) rechazarse con 412 y código `PRECONDITION_FAILED` indicando `currentVersion`, sin aplicar cambios; un conflicto detectado al persistir DEBE (MUST) responder 409 con código `CONCURRENCY_CONFLICT`. Nunca se pierde una actualización en silencio.
Trace: FR-TRANSACTIONS-011, NFR-DATA-014 · Priority: Must

#### Scenario: Dos pestañas editan el mismo gasto
- **CUANDO** un gasto de 75.00 BOB en versión 4 se edita a 80.00 BOB desde una pestaña (pasa a versión 5) y otra pestaña envía 90.00 BOB con `If-Match: "4"`
- **ENTONCES** la segunda respuesta es 412 con código `PRECONDITION_FAILED` y `currentVersion` 5
- **Y** el gasto queda en 80.00 BOB

### Requirement: Paginación por cursor
Toda colección DEBE (MUST) paginarse por cursor opaco con `limit` (por defecto 50, máximo 200) y responder `data` y `page` con `limit`, `hasMore` y `nextCursor`, con un orden total estable que no omita ni repita elementos al recorrer todas las páginas.
Trace: FR-TRANSACTIONS-012 · Priority: Must

#### Scenario: Recorrido completo de una colección
- **CUANDO** un workspace con 120 transacciones se lista con `limit=50` siguiendo `nextCursor`
- **ENTONCES** se obtienen tres páginas de 50, 50 y 20 elementos, la última con `hasMore` falso y `nextCursor` nulo
- **Y** cada transacción aparece exactamente una vez

#### Scenario: Límite por encima del máximo
- **CUANDO** un cliente pide una colección con `limit=500`
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED`

### Requirement: Rechazo de cursores inválidos
Un cursor manipulado, de otro recurso o emitido para filtros u orden distintos DEBE (MUST) rechazarse con 400 y código `INVALID_CURSOR`; un cursor NO DEBE (MUST NOT) dar acceso a datos fuera del workspace de la ruta.
Trace: FR-TRANSACTIONS-012, NFR-SEC-009 · Priority: Must

#### Scenario: Cursor alterado
- **CUANDO** un cliente modifica un byte del `nextCursor` recibido y lo envía
- **ENTONCES** la respuesta es 400 con código `INVALID_CURSOR`

#### Scenario: Cursor con otros filtros
- **CUANDO** un cliente usa un cursor obtenido con `currency=BOB` en una petición con `currency=USD`
- **ENTONCES** la respuesta es 400 con código `INVALID_CURSOR`

### Requirement: Límite de tasa por usuario
La API DEBE (MUST) limitar la tasa de peticiones por usuario y por workspace, informar la cuota con las cabeceras `RateLimit` y `RateLimit-Policy` y, al excederla, responder 429 con código `RATE_LIMITED` y cabecera `Retry-After`, sin ejecutar la operación.
Trace: NFR-SEC-011 · Priority: Should

#### Scenario: Ráfaga de escrituras
- **CUANDO** un usuario envía 121 escrituras en menos de un minuto con un límite de 120 escrituras por minuto
- **ENTONCES** la petición 121 responde 429 con código `RATE_LIMITED` y `Retry-After`
- **Y** esa petición no produce efectos
