---
id: TC-REPORTING-FORECAST-010
title: "Sin déficit el riesgo es NONE o LOW según el margen del 10 % de los egresos y otra moneda usa umbral cero"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Riesgo de déficit por moneda"
scenario: "Sin riesgo y riesgo bajo"
requirement_status: confirmed
fr: ["FR-REPORTING-015"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-risk.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","shortfall"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Caja USD\" 100.00 USD con \"Spotify\" 5.99 USD del 2026-10-25"
input: {"horizon":30}
steps:
  - "Calcular con reserva 1500.00 BOB"
  - "Calcular con reserva 3500.00 BOB"
expected_result:
  - "Reserva 1500.00: BOB NONE"
  - "Reserva 3500.00: BOB LOW (3821.00 < 3929.95)"
  - "USD: umbral 0.00 USD, mínimo 94.01 USD el 2026-10-25, NONE"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-010 — Sin déficit el riesgo es NONE o LOW según el margen del 10 % de los egresos y otra moneda usa umbral cero

## Intención

Los niveles intermedios no deben confundirse con déficit; la reserva vive en su moneda (D214).

## Escenario

```gherkin
Dado "Caja USD" 100.00 USD con "Spotify" 5.99 USD del 2026-10-25
Cuando Calcular con reserva 1500.00 BOB
Entonces Reserva 1500.00: BOB NONE
  Y Reserva 3500.00: BOB LOW (3821.00 < 3929.95)
  Y USD: umbral 0.00 USD, mínimo 94.01 USD el 2026-10-25, NONE
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Riesgo de déficit por moneda" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
