---
id: TC-FORECAST-CASHFLOW-003
title: "La serie del gasto variable líquido en dólares no se convierte"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico del gasto variable por moneda para el flujo de caja"
scenario: "Serie en dólares sin conversión"
requirement_status: provisional
fr: ["FR-FORECAST-008","FR-FORECAST-003"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["cash-flow","multi-currency"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "en 2026-10 se pagaron 120.00 USD de gastos variables desde \"Banco USD\""
expected_result:
  - "la serie del gasto variable líquido en USD tiene 120.00 USD en 2026-10 y no se convierte a BOB"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-CASHFLOW-003 — La serie del gasto variable líquido en dólares no se convierte

## Intención

Verifica el scenario "Serie en dólares sin conversión" del requirement "Pronóstico del gasto variable por moneda para el flujo de caja" de `forecast/expense-forecasting` (FR-FORECAST-008, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando en 2026-10 se pagaron 120.00 USD de gastos variables desde "Banco USD"
Entonces la serie del gasto variable líquido en USD tiene 120.00 USD en 2026-10 y no se convierte a BOB
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
