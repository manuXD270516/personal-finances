# Spec Delta

## Purpose

Define las barreras que garantizan que cada usuario solo vea y modifique datos de los workspaces donde es miembro y solo en la medida que su rol lo permite: verificación de membresía, autorización por rol en cada caso de uso y aislamiento por workspace reforzado en la base de datos.

## ADDED Requirements

### Requirement: Rechazo a usuarios que no son miembros del workspace
Toda operación sobre un workspace DEBE (MUST) verificar, en cada petición y antes de ejecutar el caso de uso, que el usuario tiene una membresía activa en el workspace de la ruta; si no la tiene, DEBE (MUST) responder 403 con código `WORKSPACE_ACCESS_DENIED` sin devolver datos ni producir efectos.
Trace: FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: Usuario ajeno intenta leer y escribir en otro workspace
- **CUANDO** "outsider@demo.pfos.test", miembro solo de "W2 Other Demo", lista las cuentas de "W1 Personal Demo" e intenta registrar allí un gasto de 75.00 BOB
- **ENTONCES** ambas respuestas son 403 con código `WORKSPACE_ACCESS_DENIED`
- **Y** no se registra ninguna transacción, asiento, registro de auditoría ni evento en "W1 Personal Demo"

#### Scenario: Membresía revocada
- **CUANDO** un usuario cuya membresía en "W1 Personal Demo" fue revocada consulta sus transacciones
- **ENTONCES** la respuesta es 403 con código `WORKSPACE_ACCESS_DENIED` desde la primera petición posterior a la revocación

### Requirement: Autorización basada en roles
Cada caso de uso DEBE (MUST) autorizarse según el rol del usuario en el workspace: OWNER puede todo; EDITOR puede leer y modificar datos financieros pero no la configuración del workspace ni las membresías; VIEWER solo puede leer. Una operación no permitida DEBE (MUST) responder 403 con código `INSUFFICIENT_ROLE` sin efectos.
Trace: FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta registrar un gasto
- **CUANDO** "viewer@demo.pfos.test", VIEWER de "W1 Personal Demo", intenta registrar un gasto de 75.00 BOB
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE`
- **Y** no se persiste ninguna transacción, asiento, registro de auditoría ni evento

#### Scenario: VIEWER consulta datos
- **CUANDO** "viewer@demo.pfos.test" lista las cuentas y las transacciones de "W1 Personal Demo"
- **ENTONCES** ambas respuestas son 200

#### Scenario: EDITOR intenta cambiar la configuración del workspace
- **CUANDO** "editor@demo.pfos.test", EDITOR de "W1 Personal Demo", intenta cambiar la moneda base a USD
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE` y la moneda base sigue siendo BOB

#### Scenario: EDITOR registra un gasto
- **CUANDO** "editor@demo.pfos.test" registra un gasto de 75.00 BOB en "W1 Personal Demo"
- **ENTONCES** la autorización se concede y el gasto se procesa

### Requirement: Matriz de autorización declarada para toda operación
Toda operación de la API DEBE (MUST) declarar el rol mínimo requerido y esa declaración DEBE (MUST) coincidir con la que aplica el servidor; el quality gate DEBE (MUST) fallar si una operación carece de declaración o si la respuesta real de algún rol (OWNER, EDITOR, VIEWER, no miembro, anónimo) no coincide con la matriz.
Trace: FR-IDENTITY-006, NFR-SEC-002, NFR-SEC-003 · Priority: Must

#### Scenario: Operación nueva sin rol declarado
- **CUANDO** se agrega al contrato una operación sin declaración de rol mínimo
- **ENTONCES** el quality gate de la pull request falla indicando la operación

#### Scenario: Ejecución de la matriz completa
- **CUANDO** se ejecuta cada operación del contrato con cada rol
- **ENTONCES** los pares permitidos responden 2xx y los denegados responden 401, 403 o 404 según la matriz
- **Y** las operaciones de configuración del workspace solo son permitidas al OWNER

### Requirement: Aislamiento de datos por workspace
La base de datos DEBE (MUST) restringir toda lectura y escritura de tablas de negocio al workspace fijado en el contexto de la transacción, aunque la consulta de la aplicación omita el filtro por workspace; escribir una fila de otro workspace DEBE (MUST) fallar.
Trace: FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: Consulta sin filtro con contexto de W1
- **CUANDO** con el contexto fijado en "W1 Personal Demo" se consultan sin filtro las cuentas, asientos, postings, transacciones, categorías y registros de auditoría
- **ENTONCES** solo se devuelven filas de "W1 Personal Demo"
- **Y** la cuenta "W2 Bank" con saldo 5000.00 BOB no aparece

#### Scenario: Escritura hacia otro workspace
- **CUANDO** con el contexto fijado en "W1 Personal Demo" se intenta insertar una fila con el workspace "W2 Other Demo" o actualizar filas de "W2 Other Demo"
- **ENTONCES** la inserción falla por la política de aislamiento y la actualización afecta 0 filas

### Requirement: Aislamiento fail-closed sin contexto de workspace
Una transacción de base de datos sin workspace fijado NO DEBE (MUST NOT) leer ni escribir filas de tablas de negocio; toda consulta o escritura DEBE (MUST) fallar con un error explícito de contexto ausente, nunca devolver un resultado vacío en silencio ni acceder a todos los workspaces.
Trace: NFR-SEC-003 · Priority: Must

#### Scenario: Consulta sin contexto
- **CUANDO** el rol de aplicación consulta la tabla de transacciones en una transacción sin workspace fijado
- **ENTONCES** la consulta falla con un error explícito de contexto de workspace ausente
- **Y** no se devuelve ninguna fila de negocio

#### Scenario: Inserción sin contexto
- **CUANDO** el rol de aplicación intenta insertar una transacción de 75.00 BOB sin workspace fijado
- **ENTONCES** la inserción falla y no se persiste nada

### Requirement: Contexto de workspace acotado a cada transacción
El workspace y el usuario del contexto de base de datos DEBEN (MUST) fijarse solo para la transacción en curso y desaparecer al terminarla, de modo que una conexión reutilizada del pool NO DEBE (MUST NOT) heredar el contexto de una petición anterior.
Trace: NFR-SEC-004 · Priority: Must

#### Scenario: Peticiones intercaladas en el mismo pool
- **CUANDO** se ejecutan concurrentemente 200 peticiones intercaladas de "W1 Personal Demo" y "W2 Other Demo" sobre un pool de 2 conexiones
- **ENTONCES** ninguna respuesta de W1 contiene datos de W2 ni viceversa

#### Scenario: Conexión reutilizada tras una transacción
- **CUANDO** una conexión que ejecutó una transacción con contexto de W1 se reutiliza para una consulta sin fijar contexto
- **ENTONCES** la consulta no ve filas de W1

### Requirement: Recursos de otro workspace indistinguibles de inexistentes
Un miembro de un workspace que solicite por identificador un recurso de otro workspace bajo la ruta de su propio workspace DEBE (MUST) recibir 404 con código `RESOURCE_NOT_FOUND`, y un identificador de otro workspace en el cuerpo DEBE (MUST) rechazarse con 422 y código `REFERENCE_NOT_FOUND`, sin revelar datos del otro workspace.
Trace: FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: Identificador de cuenta ajena en la ruta
- **CUANDO** "owner@demo.pfos.test" solicita en la ruta de "W1 Personal Demo" la cuenta "W2 Bank" (saldo 5000.00 BOB) de "W2 Other Demo"
- **ENTONCES** la respuesta es 404 con código `RESOURCE_NOT_FOUND` y no incluye el nombre ni el saldo de "W2 Bank"

#### Scenario: Identificador de cuenta ajena en el cuerpo
- **CUANDO** un EDITOR de "W1 Personal Demo" registra en W1 un gasto de 75.00 BOB indicando como cuenta el identificador de "W2 Bank"
- **ENTONCES** la respuesta es 422 con código `REFERENCE_NOT_FOUND` y no se registra nada

### Requirement: Privilegios mínimos del rol de aplicación en base de datos
Los procesos de aplicación DEBEN (MUST) conectarse a la base de datos con roles que no pueden saltarse el aislamiento por workspace, no son dueños de tablas ni ejecutan cambios de esquema; los cambios de esquema DEBEN (MUST) ejecutarse con un rol de migración distinto.
Trace: NFR-SEC-003, NFR-SEC-016 · Priority: Must

#### Scenario: Verificación de privilegios
- **CUANDO** se inspeccionan los roles de base de datos de la API y del worker
- **ENTONCES** ninguno puede saltarse las políticas de aislamiento ni es dueño de una tabla de negocio
- **Y** un intento de crear o alterar una tabla con esos roles falla

### Requirement: Tablas de negocio con aislamiento obligatorio
Toda tabla de negocio con columna de workspace DEBE (MUST) tener el aislamiento por workspace habilitado y forzado con al menos una política; el quality gate DEBE (MUST) fallar si una migración agrega una tabla de negocio sin ese aislamiento.
Trace: NFR-SEC-003 · Priority: Must

#### Scenario: Migración con tabla sin política
- **CUANDO** una pull request agrega una tabla de negocio con columna de workspace sin política de aislamiento forzada
- **ENTONCES** el quality gate falla indicando la tabla
