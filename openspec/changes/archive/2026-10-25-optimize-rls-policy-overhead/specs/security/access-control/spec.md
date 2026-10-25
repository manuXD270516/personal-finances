## ADDED Requirements

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
La suite de integración DEBE (MUST) verificar con las políticas de aislamiento vigentes que, con el contexto de un workspace, las lecturas sin filtro de las tablas del ledger y de cuentas no devuelven filas de otro workspace y las inserciones hacia otro workspace fallan. DEBE (MUST) además recorrer cada tabla de negocio registrada sin contexto de workspace con una lectura filtrada por un workspace existente, una lectura sin filtro y una inserción, fallar si alguna operación devuelve filas de negocio, y listar como hallazgo cada operación que devuelva un resultado vacío sin el error explícito de contexto ausente. Esta verificación NO DEBE (MUST NOT) relajar el requirement de aislamiento fail-closed sin contexto: un hallazgo se corrige en un change de seguridad aparte.
Trace: FR-IDENTITY-006, NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Lectura y escritura cruzadas en las tablas del ledger y de cuentas
- **CUANDO** con el contexto fijado en "W1 Personal Demo" se consultan sin filtro las cuentas, asientos, postings y saldos, y se intenta insertar una cuenta del ledger con el workspace "W2 Other Demo"
- **ENTONCES** solo se devuelven filas de "W1 Personal Demo" y la cuenta "W2 Bank" con saldo 5000.00 BOB no aparece
- **Y** la inserción hacia "W2 Other Demo" falla por la política de aislamiento

#### Scenario: Matriz sin contexto por tabla registrada
- **CUANDO** para cada tabla de negocio registrada se ejecutan, sin workspace fijado, una lectura filtrada por un workspace existente, una lectura sin filtro y una inserción
- **ENTONCES** ninguna operación devuelve filas de negocio
- **Y** cada operación que devuelve un resultado vacío sin el error de contexto ausente queda listada como hallazgo con su tabla y su operación
