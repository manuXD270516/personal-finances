---
id: TC-FORECAST-EXPENSE-008
title: "Con 14 periodos los candidatos excluyen el suavizado estacional"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Modelos candidatos según la historia"
scenario: "Serie de 14 periodos"
requirement_status: confirmed
fr: ["FR-FORECAST-007"]
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - services/ml-forecasting/tests/test_phase8.py
status: automated
regression_suite: false
phase: 8
tags: ["models","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto total tiene 14 periodos de historia"
expected_result:
  - "los candidatos son último periodo, promedio de 3, 6 y 12 periodos, mismo periodo del año anterior y suavizado exponencial con tendencia amortiguada, sin el estacional"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-008 — Con 14 periodos los candidatos excluyen el suavizado estacional

## Intención

Verifica el scenario "Serie de 14 periodos" del requirement "Modelos candidatos según la historia" de `forecast/expense-forecasting` (FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el gasto total tiene 14 periodos de historia
Entonces los candidatos son último periodo, promedio de 3, 6 y 12 periodos, mismo periodo del año anterior y suavizado exponencial con tendencia amortiguada, sin el estacional
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
