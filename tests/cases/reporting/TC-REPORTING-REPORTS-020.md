---
id: TC-REPORTING-REPORTS-020
title: "El drill-down de un componente del flujo de caja y de un día del historial suma su cifra"
spec: reporting/financial-reports
related_specs: ["ledger/balances"]
requirement: "Drill-down del flujo de caja y del historial de saldo"
scenario: "Componente deuda de octubre"
requirement_status: provisional
fr: ["FR-REPORTING-010"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["drill-down", "cash-flow"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Componente deuda de 2026-10 = −500.00 BOB por un pago de tarjeta"
  - "\"Banco BOB\" con −3500.00 BOB el 2026-10-10"
input: {}
steps:
  - "Abrir el drill-down del componente deuda"
  - "Abrir el drill-down del día 2026-10-10 del historial"
expected_result:
  - "Se lista el movimiento −500.00 BOB de \"Banco BOB\" con enlace al pago de tarjeta"
  - "Se lista el movimiento −3500.00 BOB del día"
  - "Σ movimientos = cifra de origen"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-020 — El drill-down de un componente del flujo de caja y de un día del historial suma su cifra

## Intención

El flujo de caja y el historial también se explican hasta la transacción.

## Escenario

```gherkin
Dado el componente deuda de −500.00 BOB
Cuando se abre su drill-down
Entonces se lista el pago de tarjeta de −500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
