---
id: TC-REPORTING-FORECAST-004
title: "Una ocurrencia vencida sin resolver se aplica hoy marcada con sus días de atraso"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Saldo esperado diario por moneda"
scenario: "Ocurrencia vencida aplicada hoy"
requirement_status: confirmed
fr: ["FR-REPORTING-014"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","overdue"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Netflix\" 49.00 BOB del 2026-10-15 sin resolver desde \"Banco BOB\""
input: {"horizon":30}
steps:
  - "Calcular el calendario de 30 días"
expected_result:
  - "Saldo esperado del 2026-10-20: 4151.00 BOB"
  - "\"Netflix\" en hoy, vencida, 5 días de atraso"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-004 — Una ocurrencia vencida sin resolver se aplica hoy marcada con sus días de atraso

## Intención

Lo atrasado sigue pendiente de pago y debe restar hoy, no desaparecer.

## Escenario

```gherkin
Dado "Netflix" 49.00 BOB del 2026-10-15 sin resolver desde "Banco BOB"
Cuando Calcular el calendario de 30 días
Entonces Saldo esperado del 2026-10-20: 4151.00 BOB
  Y "Netflix" en hoy, vencida, 5 días de atraso
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Saldo esperado diario por moneda" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
