---
id: TC-REPORTING-FORECAST-021
title: "El calendario de 90 días responde con p95 de 500 ms o menos con 40 cuentas y 300 ocurrencias"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Rendimiento y métricas del calendario"
scenario: "Workspace grande"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-010","NFR-OBS-004"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","perf","nightly"]
error_code: null
preconditions:
  - "Workspace con 40 cuentas líquidas en BOB y 300 ocurrencias no resueltas en 90 días"
input: {"horizon":90}
steps:
  - "Medir el calendario de 90 días en el nightly"
expected_result:
  - "p95 de reporting_cash_flow_calendar_duration_seconds ≤ 0.50 s"
  - "Resumen del Home con cashFlow ≤ 0.30 s p95"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-021 — El calendario de 90 días responde con p95 de 500 ms o menos con 40 cuentas y 300 ocurrencias

## Intención

NFR-PERF-010 y NFR-PERF-004 con lectura directa (D117).

## Escenario

```gherkin
Dado Workspace con 40 cuentas líquidas en BOB y 300 ocurrencias no resueltas en 90 días
Cuando Medir el calendario de 90 días en el nightly
Entonces p95 de reporting_cash_flow_calendar_duration_seconds ≤ 0.50 s
  Y Resumen del Home con cashFlow ≤ 0.30 s p95
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Rendimiento y métricas del calendario" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
