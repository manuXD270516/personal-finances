---
id: TC-FORECAST-EXPENSE-001
title: "El valor esperado es la suma exacta de conocidos y variable predicho"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Costos futuros conocidos separados de los variables predichos"
scenario: "Gasto total de diciembre"
requirement_status: provisional
fr: ["FR-FORECAST-003","FR-FORECAST-002"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["money","known-future"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "para el periodo 2026-12 los costos conocidos son \"Alquiler\" 2500.00 BOB, \"Internet\" 199.00 BOB y \"Netflix\" 49.00 BOB, y el modelo predice para la parte variable 1660.00 BOB con intervalo del 80 % de 1290.00 BOB a 2040.00 BOB"
expected_result:
  - "el gasto total esperado de 2026-12 es 4408.00 BOB con intervalo del 80 % de 4038.00 BOB a 4788.00 BOB"
  - "el punto informa costos conocidos 2748.00 BOB y variable predicho 1660.00 BOB"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-001 — El valor esperado es la suma exacta de conocidos y variable predicho

## Intención

Verifica el scenario "Gasto total de diciembre" del requirement "Costos futuros conocidos separados de los variables predichos" de `forecast/expense-forecasting` (FR-FORECAST-003, FR-FORECAST-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando para el periodo 2026-12 los costos conocidos son "Alquiler" 2500.00 BOB, "Internet" 199.00 BOB y "Netflix" 49.00 BOB, y el modelo predice para la parte variable 1660.00 BOB con intervalo del 80 % de 1290.00 BOB a 2040.00 BOB
Entonces el gasto total esperado de 2026-12 es 4408.00 BOB con intervalo del 80 % de 4038.00 BOB a 4788.00 BOB
  Y el punto informa costos conocidos 2748.00 BOB y variable predicho 1660.00 BOB
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
