---
id: TC-PLATFORM-THROUGHPUT-013
title: "Un consumidor lento sin umbral decidido aparece en el resumen sin cambiar el veredicto del job"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "Costo por evento de cada consumidor con handler real publicado"
scenario: "Consumidor lento sin umbral decidido"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "nightly", "perf", "D300"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Consumidor lento sin umbral decidido\" del delta de optimize-consumer-throughput"
steps:
  - "un consumidor rinde 30 eventos por segundo con su handler real y el owner todavía no fijó umbrales por consumidor"
expected_result:
  - "el resumen lo muestra como el consumidor más lento"
  - "el veredicto del job no cambia por esa fila"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-013 — Un consumidor lento sin umbral decidido aparece en el resumen sin cambiar el veredicto del job

## Intención

El benchmark nocturno DEBERÍA (SHOULD) publicar, para cada consumidor que recibe los eventos de las transacciones importadas, la duración por evento con su handler real (p50 y p95), el ritmo de procesamiento con ese consumidor como único activo, las esperas por bloqueos de base de datos observadas durante su drenado y, si está agrupado, los eventos por invocación.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando un consumidor rinde 30 eventos por segundo con su handler real y el owner todavía no fijó umbrales por consumidor
Entonces el resumen lo muestra como el consumidor más lento
  Y el veredicto del job no cambia por esa fila
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
