# security/access-control Specification

## Purpose
Define las barreras que garantizan que cada usuario solo vea y modifique datos de los workspaces donde es miembro y solo en la medida que su rol lo permite: verificación de membresía, autorización por rol en cada caso de uso y aislamiento por workspace reforzado en la base de datos.

## Requirements

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

### Requirement: Sobrecosto de RLS de la consulta de índice de saldo por cuenta como dato informativo
El benchmark nocturno de sobrecosto de la seguridad a nivel de fila DEBE (MUST) seguir midiendo la consulta de saldo por cuenta con acceso solo por índice con el criterio vigente (pares intercalados, intervalo de confianza del 95 %, 10 % y piso de 0.5 ms) y DEBE (MUST) publicar su diferencia, su intervalo y su veredicto marcados como informativos; esa fila NO DEBE (MUST NOT) hacer fallar el benchmark. Las consultas reales de saldos de la aplicación y las demás consultas bloqueantes DEBEN (MUST) seguir haciendo fallar el benchmark ante una brecha demostrada o un plan distinto. Las políticas de aislamiento NO DEBEN (MUST NOT) reescribirse para reducir el sobrecosto de esa fila sin una decisión nueva del owner.
Trace: NFR-SEC-003, NFR-PERF-005 · Priority: Should

#### Scenario: La fila de índice con sobrecosto demostrado se informa sin fallar
- **CUANDO** la consulta de saldo por cuenta con acceso solo por índice mide una mediana de 1.99 ms sin la política y de 2.80 ms con la política, con un intervalo de confianza del 95 % de la diferencia por par de 0.800 ms a 0.811 ms
- **ENTONCES** el reporte publica la fila con la diferencia, su intervalo y el veredicto "brecha demostrada", marcada como informativa
- **Y** el benchmark no falla por esa fila

#### Scenario: La consulta real de saldos sigue siendo bloqueante
- **CUANDO** la consulta real de saldos en lote mide un sobrecosto del 46.8 % con la política y su plan cambia de método de acceso frente al plan sin la política
- **ENTONCES** el benchmark falla indicando la consulta, la diferencia medida y ambos métodos de acceso
- **Y** la fila informativa de la consulta de índice no cambia ese resultado

### Requirement: Verificación del aislamiento y del fail-closed de las políticas vigentes tabla por tabla
La suite de integración DEBE (MUST) verificar con las políticas de aislamiento vigentes que, con el contexto de un workspace, las lecturas sin filtro de las tablas del ledger y de cuentas no devuelven filas de otro workspace y las inserciones hacia otro workspace fallan. DEBE (MUST) además recorrer cada tabla de negocio registrada sin workspace ni usuario fijados, con el rol de aplicación y con el rol del worker, con una lectura filtrada por un workspace existente, una lectura sin filtro y una inserción, también con las tablas de evaluación por fila vacías, y DEBE (MUST) fallar si alguna operación devuelve filas de negocio o devuelve un resultado vacío sin el error explícito de contexto ausente o de permisos. Las únicas lecturas sin contexto admitidas para el rol del worker DEBEN (MUST) ser las de la entrega de eventos entre workspaces declaradas en la verificación. Ninguna política del rol de aplicación ni del rol del worker sobre una tabla de workspace DEBE (MUST) usar la variante del contexto que devuelve nulo sin lanzar el error, salvo las de las tablas de alcance de usuario que además exigen el usuario fijado.
Trace: FR-IDENTITY-006, NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Lectura y escritura cruzadas en las tablas del ledger y de cuentas
- **CUANDO** con el contexto fijado en "W1 Personal Demo" se consultan sin filtro las cuentas, asientos, postings y saldos, y se intenta insertar una cuenta del ledger con el workspace "W2 Other Demo"
- **ENTONCES** solo se devuelven filas de "W1 Personal Demo" y la cuenta "W2 Bank" con saldo 5000.00 BOB no aparece
- **Y** la inserción hacia "W2 Other Demo" falla por la política de aislamiento

#### Scenario: Matriz sin contexto por tabla registrada
- **CUANDO** para cada tabla de negocio registrada se ejecutan con el rol de aplicación, sin workspace ni usuario fijados, una lectura filtrada por un workspace existente, una lectura sin filtro y una inserción
- **ENTONCES** ninguna operación devuelve filas de negocio
- **Y** toda operación falla con el error de contexto ausente o de permisos, y un resultado vacío sin error hace fallar la verificación indicando su tabla y su operación

#### Scenario: Matriz sin contexto con el rol del worker
- **CUANDO** la misma matriz se ejecuta con el rol del worker sin workspace ni usuario fijados
- **ENTONCES** toda operación falla con el error de contexto ausente o de permisos, salvo las lecturas declaradas de la entrega de eventos entre workspaces
- **Y** una lectura no declarada que devuelve filas o un vacío sin error hace fallar la verificación

#### Scenario: Uso acotado de la variante tolerante del contexto
- **CUANDO** se revisa el catálogo de políticas del rol de aplicación y del rol del worker
- **ENTONCES** la variante del contexto que devuelve nulo sin lanzar el error solo aparece en las políticas de lectura de workspaces y de membresías, que además exigen el usuario fijado
- **Y** una política de otra tabla que la use hace fallar la verificación

### Requirement: Fail-closed de las claves de idempotencia sin contexto
El registro de claves de idempotencia DEBE (MUST) rechazar con el error explícito de contexto ausente toda lectura o escritura de una transacción que no tenga fijados ni el workspace ni el usuario, también cuando el registro está vacío o el filtro de la consulta no encuentra filas. Con solo el usuario fijado, el registro DEBE (MUST) exponer únicamente las claves de alcance de usuario de ese usuario y NO DEBE (MUST NOT) exponer claves de ningún workspace. Con el workspace fijado, DEBE (MUST) exponer únicamente las claves de ese workspace.
Trace: NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Lecturas sin contexto con el registro vacío o sin claves del workspace
- **CUANDO** sin workspace ni usuario fijados se lee el registro de claves filtrando por "W1 Personal Demo", que no tiene claves, y también sin filtro con el registro vacío
- **ENTONCES** las dos lecturas fallan con el error explícito de contexto de workspace ausente
- **Y** ninguna devuelve un resultado vacío en silencio

#### Scenario: Claves de alcance de usuario con solo el usuario fijado
- **CUANDO** con solo el usuario "owner@demo.pfos.test" fijado se leen las claves sin filtro y filtrando por "W1 Personal Demo", que tiene la clave de un gasto de 75.00 BOB
- **ENTONCES** solo se devuelven las claves de alcance de usuario de "owner@demo.pfos.test"
- **Y** la clave del gasto de 75.00 BOB de "W1 Personal Demo" no se devuelve

### Requirement: Fail-closed de las exportaciones del workspace sin contexto y barrido de retención con rol de mantenimiento
El registro de exportaciones del workspace DEBE (MUST) rechazar con el error explícito de contexto ausente toda lectura o escritura sin workspace fijado del rol de aplicación y del rol del worker, filtrada o no, también con el registro vacío. El barrido de retención entre workspaces DEBE (MUST) leer las exportaciones vencidas con un rol de mantenimiento asumido solo en esa transacción, que vea únicamente las exportaciones listas con la expiración vencida y solo los datos necesarios para expirarlas, y que NO DEBE (MUST NOT) poder escribirlas; la expiración de cada exportación DEBE (MUST) seguir ejecutándose con el contexto de su workspace.
Trace: FR-IDENTITY-010, NFR-SEC-003 · Priority: Must

#### Scenario: Lecturas sin contexto de las exportaciones
- **CUANDO** sin workspace fijado el rol de aplicación y el rol del worker leen las exportaciones filtrando por "W1 Personal Demo" y sin filtro, con una exportación lista de "W1 Personal Demo" y también con el registro vacío
- **ENTONCES** todas las lecturas fallan con el error explícito de contexto de workspace ausente
- **Y** ninguna devuelve la exportación de "W1 Personal Demo"

#### Scenario: Barrido de retención con el rol de mantenimiento
- **CUANDO** el barrido de retención, sin workspace fijado y con el rol de mantenimiento, busca exportaciones vencidas y existen una exportación lista vencida de "W1 Personal Demo", una lista vigente de "W2 Other Demo" y una descartada de "W2 Other Demo"
- **ENTONCES** solo ve la exportación lista vencida de "W1 Personal Demo", sin la clave de datos envuelta ni la ubicación del archivo
- **Y** un intento de marcarla como expirada con ese rol falla
- **Y** el job de retención la expira con el contexto de "W1 Personal Demo" y lo audita
