---
id: TC-FORECAST-CASHFLOW-002
title: "Las compras con tarjeta no entran en el gasto variable líquido"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico del gasto variable por moneda para el flujo de caja"
scenario: "Compras con tarjeta fuera de la serie"
requirement_status: confirmed
fr: ["FR-FORECAST-008","FR-FORECAST-003"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/liquid-forecast.test.ts
  - packages/contexts/forecasting/src/domain/variable-liquid-outflow.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["cash-flow","credit-cards"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "además en 2026-10 se cargaron 600.00 BOB de compras a la tarjeta \"Visa Oro\""
expected_result:
  - "la historia del gasto variable líquido en BOB de 2026-10 sigue en 1152.00 BOB"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-CASHFLOW-002 — Las compras con tarjeta no entran en el gasto variable líquido

## Intención

Verifica el scenario "Compras con tarjeta fuera de la serie" del requirement "Pronóstico del gasto variable por moneda para el flujo de caja" de `forecast/expense-forecasting` (FR-FORECAST-008, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando además en 2026-10 se cargaron 600.00 BOB de compras a la tarjeta "Visa Oro"
Entonces la historia del gasto variable líquido en BOB de 2026-10 sigue en 1152.00 BOB
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
