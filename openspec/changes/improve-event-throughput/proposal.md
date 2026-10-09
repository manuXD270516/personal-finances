# Propuesta: improve-event-throughput

## Why

Durante la implementación de Phase 2 se midió que cada consumidor de eventos procesa **~2 eventos/s**: el adapter de pg-boss trabaja con `batchSize: 1`, `localConcurrency: 1` (default de `EventConsumerRuntime`) y un polling de 0,5 s (`JOB_QUEUE_POLLING_INTERVAL_SECONDS`), así que cada consulta a la cola trae un solo trabajo. Con el volumen de Phase 1–2 (decenas de eventos por acción del usuario) alcanza, pero ya produjo flakes de integración por backlog (INAPP-007, TC-FX-PROVIDER-006, DEMO-014; PR #70) y el consumidor de umbrales de presupuesto agrega ~40 ms por evento.

Phase 6 (imports) cambia el orden de magnitud: un CSV de 5 000 filas (NFR-PERF-007) genera ≥ 5 000 eventos por consumidor; a 2 eventos/s son **~42 minutos** de retraso para presupuestos, alertas y proyecciones, lo que incumple NFR-PERF-008 (retraso outbox → handler p95 ≤ 5 s, p99 ≤ 30 s). El owner decidió el 2026-10-09 (docs/33 D112) incorporar este change al plan **antes de Phase 6**, después de `add-workspace-export`.

## What Changes

- **Throughput del consumidor**: cada consumidor procesa en paralelo eventos de **agregados distintos** (concurrencia configurable, por defecto 4) y trae varios trabajos por consulta a la cola, sin relajar el orden por agregado (`key_strict_fifo`, requirement "Orden de entrega por agregado" intacto).
- **Objetivo verificable**: un backlog de 5 000 eventos repartidos en 500 agregados se drena en ≤ 120 s por consumidor en el stack local/CI (≥ 42 eventos/s sostenidos), con handler trivial; con los consumidores reales (umbrales de presupuesto, alertas) el objetivo se mide y reporta en el benchmark nightly.
- **Costo por evento**: perfilar los consumidores más caros (umbrales de presupuesto ~40 ms, alertas) y bajar su costo donde haya consultas repetidas por evento (p. ej. cargar el plan del periodo una vez por lote o con cache por transacción), sin cambiar su comportamiento observable.
- **Observabilidad**: métrica de pendientes por consumidor (`event_consumer_backlog`, etiqueta `consumer`, baja cardinalidad) y duración de procesamiento por evento (`event_consumer_duration_seconds`), para ver el retraso por cola y no solo el del outbox.
- **Configuración**: `EVENT_CONSUMER_CONCURRENCY` (default 4) y `EVENT_CONSUMER_BATCH_SIZE` (default 10) en `@pf/platform`, con override por consumidor en su definición; documentadas en `docs/config-reference.md`.
- **Tests**: el soporte de tests (`discardStaleEventBacklog`) deja de ser necesario para aislar backlogs en los casos donde solo compensaba la lentitud; se conserva donde aísla eventos de otros archivos.
- **Fuera de alcance:** cambiar de broker (pg-boss sigue, ADR vigente), réplicas múltiples del worker (requiere el adapter Valkey del rate limiter; change aparte), orden global entre agregados, prioridades entre colas.

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `platform/event-delivery`: agrega el requirement "Rendimiento sostenido de los consumidores" y extiende las métricas con pendientes y duración por consumidor.

## Impact

**Specs impactadas:** `platform/event-delivery` (1 requirement nuevo Must; 1 requirement modificado: métricas).

**Componentes impactados:** `@pf/platform` (`PgBossJobQueue.work` con `batchSize` > 1 y procesamiento por trabajo dentro del lote con ack individual; `EventConsumerRuntime` con concurrencia por defecto configurable; métricas), consumidores de `planning` (umbrales de presupuesto) y `notifications` (alertas) para el costo por evento, `apps/api/src/worker` (config), harness de tests de integración.

**APIs impactadas:** ninguna.

**Tablas impactadas:** ninguna (las colas de pg-boss ya usan `key_strict_fifo`; no hay migración de negocio). Si el diseño requiere un índice en el esquema de pg-boss, lo crea pg-boss, no dbmate.

**Eventos impactados:** ninguno en contrato; cambia solo el ritmo de entrega.

**Migraciones requeridas:** ninguna.

**Riesgos:** reordenamiento dentro de un agregado si el lote se procesa en paralelo sin respetar la clave (mitigado: pg-boss entrega a lo sumo un trabajo activo por clave con `key_strict_fifo`; TC de orden con concurrencia 4 y lotes de 10); presión sobre el pool de conexiones (`DATABASE_POOL_MAX`) por la concurrencia sumada de todos los consumidores (el diseño fija el presupuesto de conexiones).
