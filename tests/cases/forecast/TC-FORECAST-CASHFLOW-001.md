---
id: TC-FORECAST-CASHFLOW-001
title: "La historia del gasto variable líquido resta los recurrentes resueltos pagados desde cuentas líquidas"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico del gasto variable por moneda para el flujo de caja"
scenario: "Gasto variable en bolivianos"
requirement_status: confirmed
fr: ["FR-FORECAST-008","FR-FORECAST-003"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - packages/contexts/forecasting/src/application/liquid-forecast.test.ts
  - packages/contexts/forecasting/src/domain/variable-liquid-outflow.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["cash-flow","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "en el periodo 2026-10 los gastos pagados desde cuentas líquidas en BOB suman 3900.00 BOB y las ocurrencias resueltas pagadas desde esas cuentas suman 2748.00 BOB"
expected_result:
  - "la historia del gasto variable líquido en BOB tiene 1152.00 BOB en 2026-10"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-CASHFLOW-001 — La historia del gasto variable líquido resta los recurrentes resueltos pagados desde cuentas líquidas

## Intención

Verifica el scenario "Gasto variable en bolivianos" del requirement "Pronóstico del gasto variable por moneda para el flujo de caja" de `forecast/expense-forecasting` (FR-FORECAST-008, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando en el periodo 2026-10 los gastos pagados desde cuentas líquidas en BOB suman 3900.00 BOB y las ocurrencias resueltas pagadas desde esas cuentas suman 2748.00 BOB
Entonces la historia del gasto variable líquido en BOB tiene 1152.00 BOB en 2026-10
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
