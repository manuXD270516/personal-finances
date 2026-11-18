# Propuesta: fix-outbox-relay-head-query

## Why

El relay del outbox (`packages/platform/src/events/relay.ts`, `OutboxRelay.runOnce`) selecciona en cada lote la cabeza pendiente de cada agregado con un `NOT EXISTS` correlacionado sobre `platform.outbox`. Cuando las estadísticas del planner dicen que casi no hay pendientes (por ejemplo, tras `VACUUM (ANALYZE)` con el outbox vacío y una ráfaga posterior por debajo del umbral de autoanalyze), PostgreSQL estima `rows=1` para el índice parcial de pendientes y elige un Nested Loop Anti Join con un Join Filter sobre `workspace_id` y `aggregate_id`: el costo de un lote crece con el cuadrado de los pendientes.

Diagnosticado y reproducido:

- Nightly (job `perf`, issue #147): el relay publica un lote de 200 cada ~10 s; el drenado de la importación de prueba tarda 180 s contra los 120 s del requirement «Ráfaga de un import grande con la configuración del host», y la fase A de throughput no termina de publicar en 600 s (hipótesis H7 de `stabilize-import-persist-perf`, tarea 7.5).
- PostgreSQL 18.6 aislado, con estadísticas posteriores a la purga y entradas muertas en el índice: un solo lote superó los 120 s. Con la consulta propuesta, las mismas estadísticas y las mismas filas: 86 ms.
- Riesgo en producción: tras un período tranquilo, una importación grande tardaría minutos en llegar a los consumidores (proyecciones, presupuestos, notificaciones).

## What Changes

- Relay (`relay.ts`): la cabeza de cada agregado se elige comparando `o.sequence` con una subconsulta escalar (`ORDER BY p.sequence LIMIT 1`) sobre `outbox_pending_aggregate_idx`, en lugar del `NOT EXISTS`. La subconsulta es un acceso por índice acotado por fila, sin depender de las estimaciones. La consulta pasa a una constante exportada para que los tests y el diagnóstico del nightly usen exactamente la de producción.
- Se mantienen las garantías actuales: advisory lock de relay único, solo la cabeza por agregado por lote (TC-PLATFORM-EVENTS-013), `FOR UPDATE OF o SKIP LOCKED`, encolado y marcado atómicos en la misma transacción, orden por `sequence`.
- Sin migraciones ni índices nuevos (los dos índices parciales existentes alcanzan); sin cambios de configuración ni del presupuesto de conexiones.
- Diagnóstico del nightly (`apps/api/test/perf/persist-instrumentation.ts`, `diagnoseOutbox`): usa la constante exportada en lugar de su copia de la consulta.
- Spec: un requirement ADDED en `platform/event-delivery`.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/event-delivery`: la selección de cabezas pendientes del relay tiene un costo acotado e independiente de que las estadísticas del outbox estén al día, sin cambiar qué eventos selecciona (1 requirement ADDED, Must, 3 scenarios).

## Impact

**Specs:** `platform/event-delivery` (1 ADDED). **Componentes:** `packages/platform` (relay), `apps/api/test` (integración y diagnóstico del nightly). **APIs, eventos, tablas, índices y migraciones:** ninguno; oasdiff sin cambios. **Configuración:** ninguna. **Test cases:** AÑADIDOS TC-PLATFORM-EVENTS-020, -021 y -022; TC-PLATFORM-EVENTS-013 sigue en verde sin cambios.

**Verificación de punta a punta:** el nightly (`apps/api/test/perf/imports.perf.ts`, fila del drenado, y `throughput.perf.ts`, fase A) sin tocar sus presupuestos.

**Riesgos:** la subconsulta se evalúa por cada pendiente que recorre el lote hasta juntar `batchSize` cabezas; con un agregado que acapara la mayor parte del backlog el recorrido puede llegar a todos los pendientes, pero cada evaluación es un acceso por índice acotado (costo casi lineal), no un barrido de los pendientes. La semántica frente a filas bloqueadas por otra transacción no cambia (la subconsulta no bloquea; un sucesor no sale mientras su cabeza siga pendiente).

**Relación con otros changes:** resuelve la causa del estancamiento del relay que `stabilize-import-persist-perf` dejó como H7 (tarea 7.5) y su consulta de diagnóstico; no cambia sus umbrales ni el aislamiento del harness.
