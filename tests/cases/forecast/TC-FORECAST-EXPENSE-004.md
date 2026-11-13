---
id: TC-FORECAST-EXPENSE-004
title: "Los conocidos incluyen la proyección de definiciones más allá del horizonte de generación"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Costos conocidos de todo el horizonte"
scenario: "Seguro anual fuera del horizonte de generación"
requirement_status: provisional
fr: ["FR-FORECAST-003","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["known-future","commitments"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2026-11-05 el horizonte de generación de ocurrencias llega al 2027-02-03 y la definición \"Seguro anual\" de 900.00 BOB vence cada 15 de marzo"
expected_result:
  - "los costos conocidos de 2027-03 incluyen \"Seguro anual\" por 900.00 BOB"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-004 — Los conocidos incluyen la proyección de definiciones más allá del horizonte de generación

## Intención

Verifica el scenario "Seguro anual fuera del horizonte de generación" del requirement "Costos conocidos de todo el horizonte" de `forecast/expense-forecasting` (FR-FORECAST-003, FR-COMMITMENTS-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el 2026-11-05 el horizonte de generación de ocurrencias llega al 2027-02-03 y la definición "Seguro anual" de 900.00 BOB vence cada 15 de marzo
Entonces los costos conocidos de 2027-03 incluyen "Seguro anual" por 900.00 BOB
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
