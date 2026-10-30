## ADDED Requirements

### Requirement: El benchmark del import mide dentro de su presupuesto de conexiones
Antes de medir, el benchmark nocturno del import de 5 000 filas DEBE (MUST) verificar que la suma de los tamaños máximos de los pools de conexiones que abre (API, worker, sus colas de trabajos y el propio harness) cabe en el máximo de conexiones del servidor de base de datos del benchmark menos las conexiones reservadas; si no cabe, DEBE (MUST) fallar sin medir, indicando la suma, el límite y el detalle por pool. Durante la medición, el reporte DEBE (MUST) publicar por pool el máximo, el pico de conexiones en uso, el pico de adquisiciones en espera y la espera máxima de adquisición, y del servidor el pico de conexiones frente a su máximo. Si una adquisición de conexión vence, la suite DEBE (MUST) fallar con el veredicto `conexiones`, indicando el pool, las conexiones en uso, su máximo y la espera, y NO DEBE (MUST NOT) reportarlo como un fallo del drenado de los consumidores. El máximo de conexiones del servidor del benchmark NO DEBE (MUST NOT) ampliarse sin la suma medida que lo justifique.
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Must

#### Scenario: Presupuesto del benchmark que no cabe en el servidor
- **CUANDO** la suite del import va a medir con pools máximos de 52 conexiones para la API, 52 para el worker, 4 para cada cola de trabajos y 3 para el harness (115 en total) frente a un servidor con 100 conexiones máximas y 3 reservadas
- **ENTONCES** la suite falla antes de subir el archivo indicando 115 conexiones frente a un límite de 97 y el tamaño de cada pool
- **Y** el reporte no publica ninguna medición del import como válida

#### Scenario: Adquisición de conexión vencida durante el drenado
- **CUANDO** durante el drenado el pool del worker tiene 34 de 34 conexiones en uso y una adquisición espera más de 2 000 ms
- **ENTONCES** la suite falla con el veredicto `conexiones` indicando el pool del worker, 34 de 34 conexiones en uso y la espera medida
- **Y** el reporte publica el pico de conexiones del servidor frente a su máximo, separado del resultado del drenado

### Requirement: El drenado del benchmark del import se publica por consumidor
El benchmark nocturno del import de 5 000 filas DEBE (MUST) publicar, para cada consumidor de eventos, los eventos pendientes al terminar la persistencia, el tiempo hasta dejarlos en 0 medido desde la persistencia y su ritmo en eventos por segundo. Cada consumidor DEBE (MUST) dejar su backlog en 0 en 120 s o menos desde la persistencia; si el drenado los supera, la suite DEBE (MUST) fallar indicando el tiempo medido, el presupuesto de 120 s y los consumidores que terminaron después del presupuesto con sus tiempos. El presupuesto de 120 s NO DEBE (MUST NOT) cambiarse ni volverse informativo sin una decisión del owner registrada.
Trace: NFR-PERF-008 · Priority: Must

#### Scenario: Import de 5 000 filas con el drenado dentro del presupuesto
- **CUANDO** el job de rendimiento corre la suite del import con un extracto de 5 000 filas nuevas después de las demás suites
- **ENTONCES** ninguna adquisición de conexión vence y cada consumidor deja su backlog en 0 en 120 s o menos desde la persistencia
- **Y** el reporte publica para cada consumidor los eventos pendientes al terminar la persistencia, su tiempo de drenado y sus eventos por segundo

#### Scenario: Drenado marginal sobre el presupuesto
- **CUANDO** los consumidores terminan de drenar 123,5 s después de la persistencia, frente a un presupuesto de 120 s
- **ENTONCES** la suite falla indicando 123,5 s frente a 120 s y los consumidores que terminaron después de 120 s con su tiempo
- **Y** el veredicto es de drenado y no de conexiones
