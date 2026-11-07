---
id: TC-REPORTING-FORECAST-013
title: "La serie de cada cuenta líquida suma la de su moneda y una cuenta no líquida se rechaza"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Saldo esperado por cuenta"
scenario: "Banco y efectivo con transferencia"
requirement_status: confirmed
fr: ["FR-REPORTING-014"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/cash-flow-calendar.api.test.ts
  - apps/web/src/ui/cash-flow/cash-flow.test.tsx
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","accounts"]
error_code: INVALID_FILTER
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Ahorro mensual\" 500.00 BOB del 2026-10-25 de \"Banco BOB\" a \"Efectivo BOB\""
input: {"horizon":30}
steps:
  - "Pedir la serie de \"Banco BOB\" y de \"Efectivo BOB\""
  - "Pedir la serie de \"Plazo fijo\""
expected_result:
  - "\"Banco BOB\" final 7200.50 BOB, mínimo 2821.00 BOB el 2026-10-28"
  - "\"Efectivo BOB\" 1000.00 BOB desde el 2026-10-25"
  - "Σ de ambas = serie BOB cada día"
  - "\"Plazo fijo\": 400 INVALID_FILTER"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-013 — La serie de cada cuenta líquida suma la de su moneda y una cuenta no líquida se rechaza

## Intención

FR-REPORTING-014 pide saldo esperado por cuenta además del total líquido.

## Escenario

```gherkin
Dado "Ahorro mensual" 500.00 BOB del 2026-10-25 de "Banco BOB" a "Efectivo BOB"
Cuando Pedir la serie de "Banco BOB" y de "Efectivo BOB"
Entonces "Banco BOB" final 7200.50 BOB, mínimo 2821.00 BOB el 2026-10-28
  Y "Efectivo BOB" 1000.00 BOB desde el 2026-10-25
  Y Σ de ambas = serie BOB cada día
  Y "Plazo fijo": 400 INVALID_FILTER
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Saldo esperado por cuenta" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
