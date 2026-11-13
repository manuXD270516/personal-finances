---
id: TC-FORECAST-EXPENSE-019
title: "El ingreso total suma el sueldo conocido y el ingreso variable predicho"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico del ingreso total"
scenario: "Sueldo conocido y extras variables"
requirement_status: confirmed
fr: ["FR-FORECAST-001","FR-FORECAST-003"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/expense-forecast.test.ts
  - packages/contexts/forecasting/src/domain/forecast-composer.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["income","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "para 2026-12 el \"Sueldo\" esperado es 8000.00 BOB y el modelo predice 350.00 BOB de ingreso variable con intervalo del 80 % de 0.00 BOB a 900.00 BOB"
expected_result:
  - "el ingreso total esperado de 2026-12 es 8350.00 BOB con intervalo del 80 % de 8000.00 BOB a 8900.00 BOB"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-019 — El ingreso total suma el sueldo conocido y el ingreso variable predicho

## Intención

Verifica el scenario "Sueldo conocido y extras variables" del requirement "Pronóstico del ingreso total" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando para 2026-12 el "Sueldo" esperado es 8000.00 BOB y el modelo predice 350.00 BOB de ingreso variable con intervalo del 80 % de 0.00 BOB a 900.00 BOB
Entonces el ingreso total esperado de 2026-12 es 8350.00 BOB con intervalo del 80 % de 8000.00 BOB a 8900.00 BOB
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
