---
id: TC-FORECAST-EXPENSE-012
title: "Los motivos suman exactamente la parte variable predicha"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Motivos del pronóstico"
scenario: "Motivos del gasto de diciembre"
requirement_status: confirmed
fr: ["FR-FORECAST-003"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/forecast-composer.test.ts
  - services/ml-forecasting/tests/test_phase8.py
status: automated
regression_suite: false
phase: 8
tags: ["explainability"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto total de 2026-12 tiene promedio variable 1552.00 BOB, el modelo estacional suma 120.00 BOB por diciembre y la parte variable predicha es 1660.00 BOB"
expected_result:
  - "los motivos informan promedio 1552.00 BOB, estacionalidad +120.00 BOB, tendencia y nivel reciente −12.00 BOB y costos conocidos 2748.00 BOB con sus tres compromisos"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-012 — Los motivos suman exactamente la parte variable predicha

## Intención

Verifica el scenario "Motivos del gasto de diciembre" del requirement "Motivos del pronóstico" de `forecast/expense-forecasting` (FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el gasto total de 2026-12 tiene promedio variable 1552.00 BOB, el modelo estacional suma 120.00 BOB por diciembre y la parte variable predicha es 1660.00 BOB
Entonces los motivos informan promedio 1552.00 BOB, estacionalidad +120.00 BOB, tendencia y nivel reciente −12.00 BOB y costos conocidos 2748.00 BOB con sus tres compromisos
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
