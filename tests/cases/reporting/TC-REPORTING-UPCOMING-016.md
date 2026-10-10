---
id: TC-REPORTING-UPCOMING-016
title: "El saldo proyectado suma ingresos pendientes, resta egresos pendientes y no toca el saldo contable"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Saldo proyectado por cuenta"
scenario: "Banco con un gasto y un ingreso pendientes"
requirement_status: confirmed
fr: ["FR-LEDGER-013","FR-LEDGER-012"]
nfr: []
invariants: ["INV-001"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/upcoming-payments.api.test.ts
  - apps/web/src/ui/upcoming/upcoming.test.tsx
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/projected-balance.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["projected-balance"]
error_code: null
preconditions:
  - "\"Banco BOB\" con saldo contable 4000.00 BOB"
  - "Gasto pendiente \"Cena\" 300.00 BOB e ingreso pendiente \"Reembolso seguro\" 150.00 BOB en \"Banco BOB\""
  - "Ocurrencia \"Internet\" 199.00 BOB de \"Banco BOB\" programada sin materializar"
  - "\"Wallet USDT\" con 50.000000 USDT y sin pendientes"
input: {"days":30}
steps:
  - "Consultar projectedBalances"
expected_result:
  - "Banco BOB: booked 4000.00, pendingIn 150.00, pendingOut 300.00, projected 3850.00 BOB"
  - "Internet no descuenta del proyectado"
  - "Wallet USDT: projected 50.000000 USDT"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-016 — El saldo proyectado suma ingresos pendientes, resta egresos pendientes y no toca el saldo contable

## Intención

FR-LEDGER-013: el saldo proyectado es una proyección de Reporting, separada del saldo contable del ledger.

## Escenario

```gherkin
Dado Banco BOB con 4000.00 BOB, un gasto pendiente de 300.00 y un ingreso pendiente de 150.00
Cuando consulto el saldo proyectado
Entonces es 3850.00 BOB y el contable sigue en 4000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
