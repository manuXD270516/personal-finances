---
id: TC-FORECAST-ACCURACY-005
title: "Un import tardío reevalúa el periodo dentro de la ventana"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Evaluación al terminar el periodo con reevaluación acotada"
scenario: "Importación tardía dentro de la ventana"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["accuracy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2026-12-20 se importan 80.00 BOB de gasto de 2026-11"
expected_result:
  - "el trabajo del 2026-12-21 reevalúa 2026-11 con real 4592.40 BOB y error +242.40 BOB"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-005 — Un import tardío reevalúa el periodo dentro de la ventana

## Intención

Verifica el scenario "Importación tardía dentro de la ventana" del requirement "Evaluación al terminar el periodo con reevaluación acotada" de `forecast/expense-forecasting` (FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el 2026-12-20 se importan 80.00 BOB de gasto de 2026-11
Entonces el trabajo del 2026-12-21 reevalúa 2026-11 con real 4592.40 BOB y error +242.40 BOB
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
