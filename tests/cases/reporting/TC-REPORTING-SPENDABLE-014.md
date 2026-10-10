---
id: TC-REPORTING-SPENDABLE-014
title: "El cálculo del disponible cabe en el presupuesto del Home con un workspace grande y expone su métrica"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Rendimiento y métricas del disponible"
scenario: "Workspace grande"
requirement_status: provisional
fr: ["FR-REPORTING-002"]
nfr: ["NFR-PERF-004", "NFR-OBS-004"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "perf"]
error_code: null
preconditions:
  - "Dataset con 40 cuentas, 300 ocurrencias no resueltas en el periodo, 20 metas con reservas y plan y 4 monedas"
input: {}
steps:
  - "Benchmark de GET W/reports/summary con el bloque spendable (nightly perf)"
expected_result:
  - "p95 de reporting_spendable_duration_seconds ≤ 0.30 s"
  - "Métrica sin etiquetas de alta cardinalidad"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-014 — El cálculo del disponible cabe en el presupuesto del Home con un workspace grande y expone su métrica

## Intención

NFR-PERF-004: el Home no se degrada por Q5.

## Escenario

```gherkin
Dado un workspace con 40 cuentas, 300 ocurrencias y 20 metas
Cuando se mide el resumen del Home
Entonces el p95 del disponible es como máximo 0.30 s
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
