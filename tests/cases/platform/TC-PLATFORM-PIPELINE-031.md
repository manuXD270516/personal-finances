---
id: TC-PLATFORM-PIPELINE-031
title: "El import de 5 000 filas drena cada consumidor en 120 s o menos desde la persistencia y el reporte publica el drenado por consumidor"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline", "platform/event-delivery"]
requirement: "El drenado del benchmark del import se publica por consumidor"
scenario: "Import de 5 000 filas con el drenado dentro del presupuesto"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-008]
invariants: []
priority: high
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "drain", "imports"]
error_code: null
preconditions:
  - "Job perf del nightly con el orden fijo PERF_SUITE_ORDER (imports al final), la purga y la espera de quietud del change 48"
  - "Arreglo del grupo 4 aplicado"
input:
  rows: 5000
  drain_budget_ms: 120000
steps:
  - "Test unitario del reporte: drainByConsumer con pendientes al terminar la persistencia, tiempo hasta 0 y ev/s por consumidor"
  - "Nightly por workflow_dispatch y dos nightlies programados seguidos: leer la tabla de conexiones y de drenado de imports en perf-summary.md"
expected_result:
  - "Ninguna adquisición de conexión vence durante la persistencia ni el drenado"
  - "Cada consumidor deja su backlog en 0 en 120 s o menos desde la persistencia"
  - "El reporte publica por consumidor los pendientes al terminar la persistencia, el tiempo de drenado y los eventos por segundo"
created: 2026-10-27
updated: 2026-10-27
---

# TC-PLATFORM-PIPELINE-031 — El import de 5 000 filas drena cada consumidor en 120 s o menos desde la persistencia y el reporte publica el drenado por consumidor

## Intención

Criterio de salida de `fix-imports-perf-connection-budget` (D299): `imports.perf.ts` en verde con lo que midió a la vista, sin cambiar el presupuesto de 120 s (D112).

## Escenario

```gherkin
Dado el job de rendimiento con las demás suites ya corridas
Cuando corre la suite del import con 5 000 filas nuevas
Entonces ninguna adquisición de conexión vence y cada consumidor drena en 120 s o menos desde la persistencia
  Y el reporte publica el drenado por consumidor
```

## Notas

- Change `fix-imports-perf-connection-budget` (D299, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)). El presupuesto de 120 s (D112) y los demás umbrales de `imports.perf.ts` no cambian (TC-PLATFORM-PIPELINE-028).
- Datos ficticios generados por el benchmark; `FixedClock` en America/La_Paz.
