## MODIFIED Requirements

### Requirement: Límite de tasa por usuario
La API DEBE (MUST) limitar la tasa de peticiones por usuario y por workspace, informar la cuota con las cabeceras `RateLimit` y `RateLimit-Policy` y, al excederla, responder 429 con código `RATE_LIMITED` y cabecera `Retry-After`, sin ejecutar la operación. Las operaciones costosas (edición masiva de transacciones, solicitud de exportación e importación de workspace y exportación CSV de auditoría) DEBEN (MUST) consumir además una cuota propia, por defecto de 10 por minuto, que una reproducción idempotente no consume.
Trace: NFR-SEC-011 · Priority: Should

#### Scenario: Ráfaga de escrituras
- **CUANDO** un usuario envía 121 escrituras en menos de un minuto con un límite de 120 escrituras por minuto
- **ENTONCES** la petición 121 responde 429 con código `RATE_LIMITED` y `Retry-After`
- **Y** esa petición no produce efectos

#### Scenario: Ráfaga de ediciones masivas
- **CUANDO** un EDITOR envía 11 ediciones masivas con claves de idempotencia distintas en menos de un minuto con la cuota costosa de 10 por minuto
- **ENTONCES** la edición 11 responde 429 con código `RATE_LIMITED` y `Retry-After`
- **Y** esa edición no modifica ninguna transacción

### Requirement: Rechazo de Idempotency-Key reutilizada con otro payload
Un POST con una `Idempotency-Key` ya usada en el mismo ámbito (workspace, o usuario en operaciones sin workspace) pero con un payload distinto DEBE (MUST) rechazarse con 422 y código `IDEMPOTENCY_KEY_REUSED`, sin ejecutar el comando. En las operaciones con archivo adjunto el contenido del archivo forma parte del payload.
Trace: FR-TRANSACTIONS-010, NFR-REL-007 · Priority: Must

#### Scenario: Misma clave, monto distinto
- **CUANDO** un EDITOR registra un gasto de 75.00 BOB con la clave "K-0001-0001-0001" y luego envía un gasto de 80.00 BOB con la misma clave
- **ENTONCES** la segunda respuesta es 422 con código `IDEMPOTENCY_KEY_REUSED`
- **Y** solo existe el gasto de 75.00 BOB

#### Scenario: Misma clave, archivo de importación distinto
- **CUANDO** un usuario solicita importar el export A con la clave "K-IMP-0001" y luego solicita importar el export B con la misma clave
- **ENTONCES** la segunda respuesta es 422 con código `IDEMPOTENCY_KEY_REUSED`
- **Y** solo existe la importación del export A
