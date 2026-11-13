---
id: TC-FORECAST-EXPENSE-009
title: "El backtesting usa cortes sin fuga de datos posteriores"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Selección del modelo por backtesting temporal"
scenario: "Cortes de una serie de 10 periodos"
requirement_status: provisional
fr: ["FR-FORECAST-007"]
nfr: []
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["backtesting","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto total tiene historia de 2026-01 a 2026-10"
expected_result:
  - "los cortes son 2026-07, 2026-08, 2026-09 y 2026-10, y desde el corte 2026-07 los candidatos se entrenan solo con 2026-01 a 2026-06"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-009 — El backtesting usa cortes sin fuga de datos posteriores

## Intención

Verifica el scenario "Cortes de una serie de 10 periodos" del requirement "Selección del modelo por backtesting temporal" de `forecast/expense-forecasting` (FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el gasto total tiene historia de 2026-01 a 2026-10
Entonces los cortes son 2026-07, 2026-08, 2026-09 y 2026-10, y desde el corte 2026-07 los candidatos se entrenan solo con 2026-01 a 2026-06
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
