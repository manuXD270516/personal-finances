---
id: TC-REPORTING-ACCURACY-003
title: "El detalle de un periodo abre el reporte de gastos por categoría"
spec: reporting/financial-reports
related_specs: []
requirement: "Detalle de un periodo del pronóstico vs real"
scenario: "Detalle de noviembre"
requirement_status: provisional
fr: ["FR-REPORTING-010","FR-FORECAST-009"]
nfr: []
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["reports","drill-down"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un miembro abre el detalle de 2026-11 desde el reporte del gasto total"
expected_result:
  - "se abre el reporte de gastos por categoría del periodo 2026-11"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-ACCURACY-003 — El detalle de un periodo abre el reporte de gastos por categoría

## Intención

Verifica el scenario "Detalle de noviembre" del requirement "Detalle de un periodo del pronóstico vs real" de `reporting/financial-reports` (FR-REPORTING-010, FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un miembro abre el detalle de 2026-11 desde el reporte del gasto total
Entonces se abre el reporte de gastos por categoría del periodo 2026-11
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
