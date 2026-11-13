---
id: TC-REPORTING-PREDICTED-011
title: "El calendario de 90 días con banda responde con p95 de 500 ms o menos"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Rendimiento del calendario con la banda predicha"
scenario: "Workspace grande con pronóstico"
requirement_status: provisional
fr: ["FR-FORECAST-006"]
nfr: ["NFR-PERF-010"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["perf","NFR-PERF-010"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el workspace del benchmark tiene 40 cuentas líquidas, 300 ocurrencias no resueltas en 90 días y un pronóstico vigente con series en BOB y USD"
expected_result:
  - "el p95 del calendario de 90 días es como máximo 0.50 s"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-PREDICTED-011 — El calendario de 90 días con banda responde con p95 de 500 ms o menos

## Intención

Verifica el scenario "Workspace grande con pronóstico" del requirement "Rendimiento del calendario con la banda predicha" de `reporting/cash-flow-calendar` (NFR-PERF-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el workspace del benchmark tiene 40 cuentas líquidas, 300 ocurrencias no resueltas en 90 días y un pronóstico vigente con series en BOB y USD
Entonces el p95 del calendario de 90 días es como máximo 0.50 s
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
