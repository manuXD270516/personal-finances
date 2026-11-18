---
id: TC-PLATFORM-EVENTS-022
title: "Con estadísticas desactualizadas la consulta de cabezas del relay usa el índice por agregado y no un anti join cuadrático"
spec: platform/event-delivery
related_specs: ["platform/delivery-pipeline"]
requirement: "Selección de cabezas del relay acotada e independiente de las estadísticas"
scenario: "Estadísticas desactualizadas tras un período tranquilo"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 8
tags: ["relay", "outbox", "planner", "perf", "fix-outbox-relay-head-query"]
error_code: null
preconditions:
  - "PostgreSQL 18.6 real; rol dueño de platform.outbox (pf_migrator) para ANALYZE"
  - "Todo dentro de una transacción revertida: no deja filas ni estadísticas en la base compartida y bloquea el autoanalyze concurrente"
  - "Datos sintéticos de un workspace propio; ningún dato del owner"
input: {"published_history": 5000, "pending": 10000, "aggregates": 2000, "per_aggregate": 5, "layout": "consecutivos por agregado", "dead_index_entries": 2000, "batchSize": 200, "ceiling_ms": 5000}
steps:
  - "BEGIN; insertar 5 000 eventos ya publicados y ejecutar ANALYZE platform.outbox"
  - "Insertar 10 000 pendientes de 2 000 agregados, 5 consecutivos por agregado, y marcar publicados 2 000 de ellos"
  - "EXPLAIN (FORMAT JSON) de la consulta de cabezas exportada por @pf/platform/events con $1 = 200"
  - "EXPLAIN (ANALYZE, FORMAT JSON) de la misma consulta"
  - "ROLLBACK"
expected_result:
  - "El plan no tiene un nodo de anti join sobre platform.outbox ni un Join Filter que compare workspace_id o aggregate_id"
  - "El plan tiene un SubPlan con un Index Scan o Index Only Scan de outbox_pending_aggregate_idx bajo un Limit"
  - "La consulta devuelve 200 filas, todas cabezas de su agregado, con Execution Time ≤ 5 000 ms"
created: 2026-11-17
updated: 2026-11-17
---

# TC-PLATFORM-EVENTS-022 — Con estadísticas desactualizadas la consulta de cabezas del relay usa el índice por agregado y no un anti join cuadrático

## Intención

Regresión del nightly (issue #147, H7 de `stabilize-import-persist-perf`): con estadísticas que estiman `rows=1` para los pendientes, la consulta con `NOT EXISTS` elegía Nested Loop Anti Join con Join Filter (cuadrático) y un lote tardaba de segundos a más de 120 s. La aserción principal es sobre el plan, que con la consulta nueva no depende de las estimaciones; el tope de tiempo es holgado (la consulta nueva tarda decenas de milisegundos).

## Escenario

```gherkin
Dado estadísticas del outbox tomadas con 5 000 publicados y ningún pendiente
  Y 10 000 pendientes de 2 000 agregados con entradas muertas en el índice parcial
Cuando se planifica y ejecuta la consulta de cabezas del relay con lote de 200
Entonces el plan resuelve cada agregado con un acceso acotado por outbox_pending_aggregate_idx
  Y no hay anti join con Join Filter de agregado
  Y el lote se selecciona en 5 s o menos
```

## Notas

- Rojo previo esperado en `main`: el plan muestra el anti join con Join Filter. Si el procedimiento no reproduce el plan malo en el contenedor, fijar estadísticas con `pg_restore_relation_stats` / `pg_restore_attribute_stats` (PostgreSQL 18) dentro de la misma transacción y anotarlo en la tarea 2.3 del change.
- La verificación de punta a punta es el nightly (`imports.perf.ts`, drenado ≤ 120 s; `throughput.perf.ts`, fase A), sin cambiar presupuestos.
- Timeout explícito del test (≥ 60 s): CI es más lento.
