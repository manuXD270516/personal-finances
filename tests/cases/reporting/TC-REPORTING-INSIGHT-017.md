---
id: TC-REPORTING-INSIGHT-017
title: "El riesgo de un plan de 40 líneas y el Home responden en 300 ms p95"
spec: reporting/predictive-insights
related_specs: []
requirement: "Rendimiento del riesgo"
scenario: "Plan grande"
requirement_status: provisional
fr: ["FR-REPORTING-020"]
nfr: ["NFR-PERF-004"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk","perf"]
error_code: null
preconditions:
  - "Workspace con un plan del periodo en curso de 40 líneas, 3000 gastos y 20 ocurrencias pendientes"
  - "Benchmark del nightly con timeout explícito"
input: {}
steps:
  - "se mide GET /periods/{periodId}/budget-risk y el resumen del Home con el bloque de riesgo"
expected_result:
  - "el riesgo del plan responde en a lo sumo 300 ms p95"
  - "el resumen del Home sigue en a lo sumo 300 ms p95"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-017 — El riesgo de un plan de 40 líneas y el Home responden en 300 ms p95

## Intención

Verifica el scenario "Plan grande" del requirement "Rendimiento del riesgo" de `reporting/predictive-insights` (FR-REPORTING-020).

## Escenario

```gherkin
Dado Workspace con un plan del periodo en curso de 40 líneas, 3000 gastos y 20 ocurrencias pendientes
Cuando se mide GET /periods/{periodId}/budget-risk y el resumen del Home con el bloque de riesgo
Entonces el riesgo del plan responde en a lo sumo 300 ms p95
Y el resumen del Home sigue en a lo sumo 300 ms p95
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
