# Tareas

> Va después de `add-workspace-export` y antes de cualquier change de Phase 6 (docs/03 §7, docs/33 D112). Resolver antes la pregunta abierta 1 de design.md.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner el requirement nuevo y la modificación de métricas de `platform/event-delivery`; verificar con `openspec validate improve-event-throughput --strict`
- [ ] 1.2 Revisar TC-PLATFORM-EVENTS-014 (backlog de 5 000 eventos drenado en ≤ 120 s), TC-PLATFORM-EVENTS-015 (orden por agregado con concurrencia 4 y lotes de 10, incluido un evento en reintento dentro del lote), TC-PLATFORM-EVENTS-016 (fallo de un trabajo no reintenta los demás del lote), TC-PLATFORM-EVENTS-017 (métricas de backlog y duración por consumidor) y TC-PLATFORM-EVENTS-018 (configuración que excede el pool rechazada al arrancar); pasar a `ready` al aprobar

## 2. INFRASTRUCTURE

- [ ] 2.1 Medir la línea base (eventos/s por consumidor con handler trivial y con los consumidores reales) y elegir entre lotes > 1 o solo concurrencia (design.md decisión 2); registrar la medición en design.md
- [ ] 2.2 `PgBossJobQueue.work` con `batchSize` configurable y confirmación/fallo por trabajo; `EventConsumerRuntime` con concurrencia por defecto configurable; variables `EVENT_CONSUMER_CONCURRENCY` y `EVENT_CONSUMER_BATCH_SIZE` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`) (TC-PLATFORM-EVENTS-014, -015, -016)
- [ ] 2.3 Validación del presupuesto de conexiones al arrancar el worker (TC-PLATFORM-EVENTS-018)
- [ ] 2.4 Métricas `event_consumer_backlog` y `event_consumer_duration_seconds` (TC-PLATFORM-EVENTS-017)
- [ ] 2.5 Perfilar y reducir el costo por evento de los consumidores de umbrales de presupuesto y alertas sin cambio observable; los tests existentes de esos consumidores siguen verdes

## 3. AUTOMATED TESTS

- [ ] 3.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter
- [ ] 3.2 Revisar los usos de `discardStaleEventBacklog` en `apps/api/test/support/harness.ts` y sus llamadores: quitarlo donde solo compensaba la lentitud, conservarlo donde aísla eventos de otros archivos; la suite de integración pasa 3 veces seguidas en CI sin reintentos
- [ ] 3.3 Benchmark nightly: throughput por consumidor con el dataset `large` (docs/29) reportado junto a `perf:bench`

## 4. DOCUMENTATION

- [ ] 4.1 Actualizar docs/11 §2/§6 (concurrencia y lotes), docs/18 (métricas nuevas), docs/02 NFR-PERF-008 (método de verificación con el benchmark) y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
