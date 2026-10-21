## ADDED Requirements

### Requirement: El benchmark nocturno mide sin interferencia de carga de fondo
Cada benchmark de latencia o de throughput del pipeline programado DEBE (MUST) empezar sin eventos pendientes ni trabajos de consumidores que provengan de una carga o de una suite anterior, de modo que solo mida el trabajo de su propia suite. El reporte DEBE (MUST) publicar, para cada suite, la carga de fondo al empezar: eventos pendientes de publicar, trabajos pendientes por consumidor, conexiones activas a la base y carga del host. Si al empezar una suite queda carga de fondo ajena que no se pudo eliminar, la suite DEBE (MUST) fallar indicando la interferencia medida y NO DEBE (MUST NOT) publicar su medición como válida.
Trace: NFR-PERF-004, NFR-PERF-008 · Priority: Must

#### Scenario: Disponible para gastar después del Large Seed
- **CUANDO** el job de rendimiento carga el Large Seed, que deja 470 165 eventos pendientes de publicar, y después corre la suite de disponible para gastar
- **ENTONCES** al empezar esa suite no queda ningún evento pendiente ni ningún trabajo de consumidor de la carga anterior
- **Y** el reporte publica para la suite 0 eventos pendientes al empezar, las conexiones activas y la carga del host, junto al p95 medido frente a 300 ms

#### Scenario: Ráfaga del matcher sin backlog ajeno
- **CUANDO** la suite de compromisos publica una ráfaga de 1 050 eventos de transacciones importadas (1 000 más 50 reentregados) hacia el matcher de compromisos
- **ENTONCES** al empezar la medición la cola del matcher contiene solo los eventos de esa ráfaga
- **Y** el throughput se calcula solo con los eventos de la ráfaga y el tiempo que tardó en procesarlos

#### Scenario: Interferencia que no se pudo eliminar
- **CUANDO** al empezar la suite de disponible para gastar quedan 12 000 eventos pendientes de una carga anterior
- **ENTONCES** la suite falla indicando la interferencia y los 12 000 eventos pendientes
- **Y** el reporte no publica su p95 como una medición válida

### Requirement: Causa de los rojos de rendimiento documentada antes de cambiar un umbral
Todo benchmark bloqueante del pipeline programado que falle en dos corridas seguidas DEBE (MUST) tener registrada en la documentación del pipeline una causa medida, con la evidencia que la sostiene, y un camino: arreglo del benchmark, arreglo del producto en un change, ajuste de umbral aprobado por el owner o change de optimización. Los umbrales de los benchmarks DEBEN (MUST) coincidir con los de los requisitos no funcionales, y NO DEBEN (MUST NOT) cambiarse ni volverse informativos sin una decisión del owner registrada; el test de política del pipeline DEBE (MUST) rechazar ese cambio en el gate de pull request.
Trace: NFR-PERF-004, NFR-PERF-008, NFR-MAINT-005 · Priority: Should

#### Scenario: Rojo con causa medida y camino
- **CUANDO** el benchmark de disponible para gastar da un p95 de 352.2 ms frente a 300 ms en dos corridas nocturnas seguidas
- **ENTONCES** la documentación del pipeline registra para ese benchmark la causa medida, las mediciones con y sin carga de fondo que la sostienen y el camino elegido
- **Y** el test case del benchmark enlaza ese registro

#### Scenario: Se intenta relajar un umbral sin decisión del owner
- **CUANDO** una pull request cambia el umbral del p95 de disponible para gastar de 300 ms a 400 ms, o el throughput mínimo por consumidor de 42 a 5 eventos por segundo, sin una decisión del owner registrada
- **ENTONCES** el test de política del pipeline falla en el gate indicando el benchmark, el umbral nuevo y el umbral de los requisitos no funcionales
