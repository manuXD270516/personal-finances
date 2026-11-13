---
id: TC-FORECAST-EXPENSE-006
title: "Una factura VARIABLE se lista sin monto y se cuenta"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Costos conocidos de todo el horizonte"
scenario: "Factura variable sin monto"
requirement_status: confirmed
fr: ["FR-FORECAST-003","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/expense-forecast.test.ts
  - packages/contexts/forecasting/src/domain/known-future.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["known-future"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Luz\" es una definición `VARIABLE` mensual"
expected_result:
  - "cada periodo lista \"Luz\" como costo conocido sin monto y la cantidad de costos sin monto es 1"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-006 — Una factura VARIABLE se lista sin monto y se cuenta

## Intención

Verifica el scenario "Factura variable sin monto" del requirement "Costos conocidos de todo el horizonte" de `forecast/expense-forecasting` (FR-FORECAST-003, FR-COMMITMENTS-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando "Luz" es una definición `VARIABLE` mensual
Entonces cada periodo lista "Luz" como costo conocido sin monto y la cantidad de costos sin monto es 1
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
