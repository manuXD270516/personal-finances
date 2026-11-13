---
id: TC-REPORTING-ACCURACY-002
title: "El reporte 16 se exporta en CSV con una fila por periodo"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de pronóstico vs real"
scenario: "Exportación del reporte"
requirement_status: provisional
fr: ["FR-REPORTING-008","FR-REPORTING-012","FR-FORECAST-009"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["reports","csv"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el VIEWER exporta el reporte en CSV"
expected_result:
  - "el archivo tiene una fila por periodo con real, esperado, límites del 80 %, error y si quedó dentro, con montos con punto decimal"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-ACCURACY-002 — El reporte 16 se exporta en CSV con una fila por periodo

## Intención

Verifica el scenario "Exportación del reporte" del requirement "Reporte de pronóstico vs real" de `reporting/financial-reports` (FR-REPORTING-008, FR-REPORTING-012, FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el VIEWER exporta el reporte en CSV
Entonces el archivo tiene una fila por periodo con real, esperado, límites del 80 %, error y si quedó dentro, con montos con punto decimal
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
