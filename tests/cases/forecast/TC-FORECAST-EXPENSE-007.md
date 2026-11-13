---
id: TC-FORECAST-EXPENSE-007
title: "Los conocidos de una cuota suman interés y seguro sin capital"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Intereses de préstamos como costo conocido"
scenario: "Cuota con interés y seguro"
requirement_status: confirmed
fr: ["FR-FORECAST-003","FR-DEBT-003"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/application/loan-schedule.queries.test.ts
  - packages/contexts/forecasting/src/domain/known-future.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["debt","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la cuota de 2026-12 del préstamo \"Auto\" es de 1500.00 BOB con 1064.65 BOB de capital, 420.35 BOB de interés y 15.00 BOB de seguro"
expected_result:
  - "los costos conocidos de 2026-12 incluyen 435.35 BOB por esa cuota"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-007 — Los conocidos de una cuota suman interés y seguro sin capital

## Intención

Verifica el scenario "Cuota con interés y seguro" del requirement "Intereses de préstamos como costo conocido" de `forecast/expense-forecasting` (FR-FORECAST-003, FR-DEBT-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la cuota de 2026-12 del préstamo "Auto" es de 1500.00 BOB con 1064.65 BOB de capital, 420.35 BOB de interés y 15.00 BOB de seguro
Entonces los costos conocidos de 2026-12 incluyen 435.35 BOB por esa cuota
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
