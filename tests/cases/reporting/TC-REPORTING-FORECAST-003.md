---
id: TC-REPORTING-FORECAST-003
title: "El saldo esperado diario parte del saldo contable y aplica pendientes y ocurrencias en su fecha"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Saldo esperado diario por moneda"
scenario: "Saldo esperado de octubre y noviembre"
requirement_status: confirmed
fr: ["FR-REPORTING-014","FR-LEDGER-013"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-001"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.properties.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","expected-balance"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Seguro anual\" 900.00 BOB del 2026-12-15"
input: {"horizon":30}
steps:
  - "Calcular el calendario de 30 días en BOB"
expected_result:
  - "Saldo inicial 4500.00 BOB"
  - "Saldos 4200.00 (2026-10-20), 4001.00 (2026-10-22), 3821.00 (2026-10-28), 11821.00 (2026-10-31), 9321.00 (2026-11-01), 8200.50 (2026-11-15 al 2026-11-19)"
  - "Saldo final 8200.50 BOB y \"Seguro anual\" no incluido"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-003 — El saldo esperado diario parte del saldo contable y aplica pendientes y ocurrencias en su fecha

## Intención

Núcleo de FR-REPORTING-014: saldo esperado día por día, exacto al centavo, sin floats.

## Escenario

```gherkin
Dado "Seguro anual" 900.00 BOB del 2026-12-15
Cuando Calcular el calendario de 30 días en BOB
Entonces Saldo inicial 4500.00 BOB
  Y Saldos 4200.00 (2026-10-20), 4001.00 (2026-10-22), 3821.00 (2026-10-28), 11821.00 (2026-10-31), 9321.00 (2026-11-01), 8200.50 (2026-11-15 al 2026-11-19)
  Y Saldo final 8200.50 BOB y "Seguro anual" no incluido
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Saldo esperado diario por moneda" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
