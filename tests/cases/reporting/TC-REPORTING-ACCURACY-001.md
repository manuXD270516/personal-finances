---
id: TC-REPORTING-ACCURACY-001
title: "El reporte 16 muestra real, esperado, intervalo y error por periodo"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de pronóstico vs real"
scenario: "Pronóstico vs real del gasto total"
requirement_status: provisional
fr: ["FR-REPORTING-008","FR-REPORTING-012","FR-FORECAST-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["reports","accuracy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un VIEWER abre el reporte para el gasto total a 1 periodo y 2026-11 tiene esperado 4350.00 BOB con intervalo del 80 % de 3980.00 BOB a 4790.00 BOB y real 4512.40 BOB"
expected_result:
  - "la fila de 2026-11 muestra real 4512.40 BOB, esperado 4350.00 BOB, el intervalo, error +162.40 BOB y dentro del intervalo"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-ACCURACY-001 — El reporte 16 muestra real, esperado, intervalo y error por periodo

## Intención

Verifica el scenario "Pronóstico vs real del gasto total" del requirement "Reporte de pronóstico vs real" de `reporting/financial-reports` (FR-REPORTING-008, FR-REPORTING-012, FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un VIEWER abre el reporte para el gasto total a 1 periodo y 2026-11 tiene esperado 4350.00 BOB con intervalo del 80 % de 3980.00 BOB a 4790.00 BOB y real 4512.40 BOB
Entonces la fila de 2026-11 muestra real 4512.40 BOB, esperado 4350.00 BOB, el intervalo, error +162.40 BOB y dentro del intervalo
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
