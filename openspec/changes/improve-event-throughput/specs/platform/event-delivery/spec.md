## ADDED Requirements

### Requirement: Rendimiento sostenido de los consumidores
Cada consumidor DEBE (MUST) procesar en paralelo eventos de agregados distintos, con concurrencia y tamaño de lote configurables, y drenar un backlog de 5 000 eventos repartidos en 500 agregados en 120 segundos o menos con un handler trivial en el entorno local/CI, sin violar el orden por agregado ni reintentar trabajos ajenos cuando uno falla. El worker NO DEBE (MUST NOT) arrancar si la concurrencia sumada de sus consumidores excede su pool de conexiones a la base de datos.
Trace: NFR-PERF-008, NFR-REL-008 · Priority: Must

#### Scenario: Backlog grande drenado a tiempo
- **CUANDO** hay 5 000 eventos pendientes para un consumidor, 10 por agregado en 500 agregados, y el consumidor arranca con la configuración por defecto
- **ENTONCES** los 5 000 eventos quedan procesados en 120 segundos o menos
- **Y** para cada agregado el consumidor observó las versiones 1 a 10 en orden creciente

#### Scenario: Un fallo dentro del lote no reintenta a los demás
- **CUANDO** un consumidor recibe en el mismo lote eventos de 10 agregados distintos y el del agregado A falla
- **ENTONCES** solo el evento del agregado A queda en reintento
- **Y** los eventos de los otros 9 agregados se registran en el inbox una sola vez

#### Scenario: Configuración que excede el pool de conexiones
- **CUANDO** el worker arranca con una concurrencia sumada de consumidores mayor que su pool de conexiones
- **ENTONCES** el arranque falla con un mensaje que indica la concurrencia total y el tamaño del pool

## MODIFIED Requirements

### Requirement: Métricas de pendientes y retraso del outbox
El sistema DEBE (MUST) exponer como métricas la cantidad de eventos pendientes de publicación (`outbox_pending`), el retraso en segundos del evento pendiente más antiguo (`outbox_lag_seconds`, 0 sin pendientes), los eventos publicados, los fallos de publicación, los duplicados descartados por consumidor, los dead-letters, los eventos pendientes por consumidor (`event_consumer_backlog`) y la duración del procesamiento por consumidor (`event_consumer_duration_seconds`), sin etiquetas de alta cardinalidad (workspace, usuario, agregado).
Trace: NFR-OBS-004 · Priority: Must

#### Scenario: Pendientes y retraso
- **CUANDO** hay 3 eventos pendientes y el más antiguo se confirmó hace 42 segundos
- **ENTONCES** `outbox_pending` reporta 3 y `outbox_lag_seconds` reporta al menos 42
- **Y** tras publicarlos `outbox_pending` reporta 0 y `outbox_lag_seconds` reporta 0

#### Scenario: Pendientes y duración por consumidor
- **CUANDO** hay 7 eventos publicados sin procesar para el consumidor `planning.budget-thresholds`
- **ENTONCES** `event_consumer_backlog` con la etiqueta `consumer="planning.budget-thresholds"` reporta 7
- **Y** tras procesarlos reporta 0 y `event_consumer_duration_seconds` registró 7 observaciones para ese consumidor
