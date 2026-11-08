---
id: TC-REPORTING-FORECAST-005
title: "Una transferencia entre cuentas líquidas no cambia el saldo de la moneda y una compra con tarjeta no resta hasta el pago"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Movimientos esperados del calendario y su certeza"
scenario: "Transferencia entre cuentas líquidas"
requirement_status: confirmed
fr: ["FR-REPORTING-014","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/cash-flow-calendar.properties.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","transfers","cards"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Ahorro mensual\" 500.00 BOB del 2026-10-25 de \"Banco BOB\" a \"Efectivo BOB\""
  - "\"Streaming\" 69.00 BOB del 2026-10-26 cargado a \"Visa Oro BOB\" (no líquida)"
input: {"horizon":30}
steps:
  - "Calcular el calendario de 30 días en BOB"
expected_result:
  - "Saldos diarios en BOB iguales a los de TC-REPORTING-FORECAST-003"
  - "Saldo final 8200.50 BOB"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-005 — Una transferencia entre cuentas líquidas no cambia el saldo de la moneda y una compra con tarjeta no resta hasta el pago

## Intención

D127/D213: solo resta lo que sale de las cuentas líquidas; la compra con tarjeta resta al pagarla.

## Escenario

```gherkin
Dado "Streaming" 69.00 BOB del 2026-10-26 cargado a "Visa Oro BOB" (no líquida)
Cuando Calcular el calendario de 30 días en BOB
Entonces Saldos diarios en BOB iguales a los de TC-REPORTING-FORECAST-003
  Y Saldo final 8200.50 BOB
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Movimientos esperados del calendario y su certeza" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
