## ADDED Requirements

### Requirement: Reescritura de las políticas de aislamiento sin pérdida de aislamiento
Toda reescritura de las políticas de aislamiento por workspace DEBE (MUST) conservar su efecto de aislamiento: con el contexto de un workspace, ninguna lectura devuelve filas de otro y toda escritura hacia otro workspace falla o no afecta filas; el aislamiento DEBE (MUST) seguir habilitado y forzado en todas las tablas de negocio con columna de workspace y el registro de esas tablas NO DEBE (MUST NOT) cambiar. Sin contexto de workspace, la política reescrita NO DEBE (MUST NOT) permitir que ninguna operación lea ni escriba una fila de ningún workspace en ninguna tabla registrada: el resultado válido DEBE (MUST) ser el error explícito de contexto ausente, o un resultado vacío o un rechazo sin ninguna fila afectada; el contexto ausente NO DEBE (MUST NOT) conceder acceso. No se exige el mismo error que con la política anterior cuando la operación no llega a evaluar ninguna fila (D297).
Trace: FR-IDENTITY-006, NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Lectura y escritura cruzadas con las políticas reescritas
- **CUANDO** con las políticas reescritas y el contexto fijado en "W1 Personal Demo" se consultan sin filtro las cuentas, asientos, postings y saldos, y se intenta insertar una cuenta del ledger con el workspace "W2 Other Demo"
- **ENTONCES** solo se devuelven filas de "W1 Personal Demo" y la cuenta "W2 Bank" con saldo 5000.00 BOB no aparece
- **Y** la inserción hacia "W2 Other Demo" falla por la política de aislamiento

#### Scenario: Sin contexto ninguna operación lee ni escribe filas en ninguna tabla registrada
- **CUANDO** con las políticas reescritas, para cada tabla de negocio registrada y sin workspace fijado, se ejecutan una lectura que filtra por un workspace existente, una lectura sin filtro y una inserción, primero con la tabla sin filas y después, en las tablas que tienen filas de "W2 Other Demo", con esas filas
- **ENTONCES** cada operación falla con el error de contexto ausente, o devuelve un resultado vacío, o es rechazada sin afectar ninguna fila
- **Y** ninguna lectura devuelve filas de negocio y ninguna inserción persiste una fila
- **Y** con filas de "W2 Other Demo" en la tabla, ninguna lectura devuelve esas filas

#### Scenario: Catálogo de aislamiento intacto
- **CUANDO** se inspecciona el catálogo después de aplicar la reescritura
- **ENTONCES** todas las tablas de negocio con columna de workspace tienen el aislamiento habilitado y forzado con al menos una política
- **Y** el registro de tablas acotadas por workspace tiene las mismas tablas, en el mismo orden, que antes de la reescritura

### Requirement: Las políticas de aislamiento no agregan trabajo por fila al plan
Las políticas de aislamiento por workspace DEBEN (MUST) evaluar el contexto de workspace una sola vez por sentencia y NO DEBEN (MUST NOT) agregar al plan de una consulta de la aplicación un nodo por el que pasen todas sus filas, ni cambiar su método de acceso o su índice frente a la misma consulta sin política. En el benchmark nocturno, la consulta de saldo por cuenta con acceso solo por índice DEBE (MUST) quedar sin brecha demostrada según el criterio de sobrecosto de RLS vigente.
Trace: NFR-SEC-003, NFR-PERF-005 · Priority: Should

#### Scenario: Plan de la consulta de saldo por cuenta
- **CUANDO** se obtiene el plan de la consulta de saldo por cuenta de un workspace con 10 864 postings, con la política y sin ella
- **ENTONCES** ambos planes tienen los mismos nodos que procesan filas, con el mismo acceso solo por índice sobre el índice de saldos
- **Y** el plan con política no tiene un nodo adicional entre el acceso por índice y la agregación

#### Scenario: Sobrecosto medido en el benchmark nocturno
- **CUANDO** el benchmark nocturno mide la consulta de saldo por cuenta con acceso solo por índice en 200 pares intercalados con y sin la política reescrita
- **ENTONCES** el veredicto de la fila no es "brecha demostrada" ni "plan distinto"
- **Y** el reporte publica la diferencia y su intervalo para compararlos con la corrida anterior a la reescritura (0.805 ms, IC95 de 0.800 a 0.811 ms)

### Requirement: Forma canónica obligatoria de las políticas de aislamiento
Toda política de aislamiento por workspace de los roles de aplicación DEBE (MUST) escribirse con la forma canónica que evalúa el contexto una sola vez por sentencia; el quality gate DEBE (MUST) fallar si una migración agrega o modifica una política de aislamiento por workspace con otra forma.
Trace: NFR-SEC-003 · Priority: Should

#### Scenario: Migración con una política en la forma anterior
- **CUANDO** una pull request agrega una tabla de negocio con columna de workspace y una política forzada que compara el workspace con el contexto sin la forma canónica
- **ENTONCES** el quality gate falla indicando la tabla y la política

## MODIFIED Requirements

### Requirement: Aislamiento fail-closed sin contexto de workspace
Una transacción de base de datos sin workspace fijado NO DEBE (MUST NOT) leer ni escribir filas de tablas de negocio de ningún workspace ni acceder a todos los workspaces; el contexto ausente NO DEBE (MUST NOT) conceder acceso. Toda consulta o escritura que llegue a evaluar una fila de una tabla de negocio DEBE (MUST) fallar con un error explícito de contexto ausente; una operación que no llega a evaluar ninguna fila (p. ej. sobre una tabla sin filas) PUEDE (MAY) devolver un resultado vacío o ser rechazada por otra restricción, siempre sin ninguna fila leída ni afectada (D297).
Trace: NFR-SEC-003 · Priority: Must

#### Scenario: Consulta sin contexto
- **CUANDO** el rol de aplicación consulta la tabla de transacciones, que tiene filas, en una transacción sin workspace fijado
- **ENTONCES** la consulta falla con un error explícito de contexto de workspace ausente
- **Y** no se devuelve ninguna fila de negocio

#### Scenario: Inserción sin contexto
- **CUANDO** el rol de aplicación intenta insertar una transacción de 75.00 BOB sin workspace fijado
- **ENTONCES** la inserción falla y no se persiste nada

#### Scenario: Tabla sin filas sin contexto
- **CUANDO** el rol de aplicación lee sin workspace fijado una tabla de negocio registrada que no tiene filas
- **ENTONCES** la lectura falla con el error de contexto ausente o devuelve un resultado vacío
- **Y** no se devuelve ninguna fila de negocio
