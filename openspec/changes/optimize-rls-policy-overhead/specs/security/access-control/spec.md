## ADDED Requirements

### Requirement: Reescritura de las políticas de aislamiento sin pérdida de aislamiento
Toda reescritura de las políticas de aislamiento por workspace DEBE (MUST) conservar exactamente su efecto: con el contexto de un workspace, ninguna lectura devuelve filas de otro y toda escritura hacia otro workspace falla o no afecta filas; el aislamiento DEBE (MUST) seguir habilitado y forzado en todas las tablas de negocio con columna de workspace y el registro de esas tablas NO DEBE (MUST NOT) cambiar. En cada tabla de negocio y forma de consulta en que la política anterior fallaba sin contexto de workspace con el error explícito de contexto ausente, la política reescrita DEBE (MUST) fallar con el mismo error y NO DEBE (MUST NOT) devolver un resultado vacío en silencio.
Trace: FR-IDENTITY-006, NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Lectura y escritura cruzadas con las políticas reescritas
- **CUANDO** con las políticas reescritas y el contexto fijado en "W1 Personal Demo" se consultan sin filtro las cuentas, asientos, postings y saldos, y se intenta insertar una cuenta del ledger con el workspace "W2 Other Demo"
- **ENTONCES** solo se devuelven filas de "W1 Personal Demo" y la cuenta "W2 Bank" con saldo 5000.00 BOB no aparece
- **Y** la inserción hacia "W2 Other Demo" falla por la política de aislamiento

#### Scenario: Sin contexto el resultado es el mismo que con la política anterior
- **CUANDO** para cada tabla de negocio registrada se ejecutan, sin workspace fijado, una lectura que filtra por un workspace existente, una lectura sin filtro y una inserción, primero con la política anterior y después con la reescrita
- **ENTONCES** cada operación que fallaba con el error de contexto ausente sigue fallando con ese error
- **Y** ninguna operación devuelve filas de negocio

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
