---
id: TC-PLATFORM-PIPELINE-024
title: "La suite de disponible para gastar empieza sin backlog del Large Seed y el reporte publica su carga de fondo"
spec: platform/delivery-pipeline
related_specs: ["reporting/dashboard", "platform/event-delivery"]
requirement: "El benchmark nocturno mide sin interferencia de carga de fondo"
scenario: "Disponible para gastar después del Large Seed"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004, NFR-PERF-008]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "background-load", "spendable"]
error_code: null
preconditions:
  - "Job perf con el Large Seed cargado y 470 165 eventos pendientes de publicar al terminar la carga"
  - "Purga del backlog residual en la base efímera tras la medición de throughput (D291)"
input:
  pending_after_seed: 470165
  suite: "spendable.perf.ts (40 cuentas, 300 ocurrencias, 20 metas, BOB)"
  threshold_p95_ms: 300
steps:
  - "Test unitario de perf-report: con una foto de carga de fondo sin eventos ni trabajos ajenos, la suite se reporta con su p95 y la tabla de carga"
  - "Corrida de nightly por workflow_dispatch: leer la tabla de carga de fondo de la suite en perf-summary.md"
expected_result:
  - "Al empezar la suite hay 0 eventos pendientes en el outbox y 0 trabajos de colas de eventos de cargas anteriores"
  - "El reporte publica para la suite los eventos pendientes, los trabajos por cola, las conexiones activas y la carga del host"
  - "El p95 se reporta frente a 300 ms como medición válida"
created: 2026-10-21
updated: 2026-10-23
---

# TC-PLATFORM-PIPELINE-024 — La suite de disponible para gastar empieza sin backlog del Large Seed y el reporte publica su carga de fondo

## Intención

S2 de `investigate-perf-under-load`: los p95 de 352,2 ms y 341,1 ms pueden venir del backlog del Large Seed que comparte la base. Un benchmark debe medir solo su propio trabajo y decir con qué carga midió.

## Escenario

```gherkin
Dado el Large Seed cargado con 470 165 eventos pendientes
Cuando corre después la suite de disponible para gastar
Entonces al empezar no queda ningún evento ni trabajo de la carga anterior
  Y el reporte publica la carga de fondo de la suite y su p95 frente a 300 ms
```

## Notas

- Change `investigate-perf-under-load` (D290, docs/46). `provisional` hasta que el owner eligiera el mecanismo de aislamiento (pregunta 1 de docs/47).
- Confirmado (2026-10-23, D291 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)): el owner eligió purgar el backlog residual (outbox y colas `events.*`) en la base efímera tras medir el throughput, solo en el harness; `requirement_status` pasa a `confirmed`.
- Datos ficticios del benchmark existente; `FixedClock` en America/La_Paz.
