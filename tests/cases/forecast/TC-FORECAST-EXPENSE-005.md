---
id: TC-FORECAST-EXPENSE-005
title: "Un conocido en dólares se convierte con la tasa de hoy declarada"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Costos conocidos de todo el horizonte"
scenario: "Suscripción en dólares"
requirement_status: confirmed
fr: ["FR-FORECAST-003","FR-COMMITMENTS-011"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/expense-forecast.test.ts
  - packages/contexts/forecasting/src/domain/known-future.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["multi-currency","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Spotify\" cuesta 9.99 USD por mes y la tasa de hoy es 6.96 BOB por USD"
expected_result:
  - "los costos conocidos de cada periodo incluyen \"Spotify\" por 69.53 BOB con la tasa declarada"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-005 — Un conocido en dólares se convierte con la tasa de hoy declarada

## Intención

Verifica el scenario "Suscripción en dólares" del requirement "Costos conocidos de todo el horizonte" de `forecast/expense-forecasting` (FR-FORECAST-003, FR-COMMITMENTS-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando "Spotify" cuesta 9.99 USD por mes y la tasa de hoy es 6.96 BOB por USD
Entonces los costos conocidos de cada periodo incluyen "Spotify" por 69.53 BOB con la tasa declarada
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
