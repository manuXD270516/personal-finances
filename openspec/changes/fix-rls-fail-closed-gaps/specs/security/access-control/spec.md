## ADDED Requirements

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

## MODIFIED Requirements

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
