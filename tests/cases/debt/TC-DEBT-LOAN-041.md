---
id: TC-DEBT-LOAN-041
title: 'Un pago de préstamo no se anula desde transacciones'
spec: transactions/transaction-recording
related_specs: ['debt/loans']
requirement: 'Transacciones de préstamo administradas por el préstamo'
scenario: 'Anular un pago desde transacciones'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-016']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['transactions', 'loans']
error_code: TRANSACTION_MANAGED_EXTERNALLY
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR anula desde transacciones el pago de 2342.02 BOB del "Préstamo vehicular"'
expected_result:
  - 'Se rechaza con `TRANSACTION_MANAGED_EXTERNALLY` y la transacción sigue vigente'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-041 — Un pago de préstamo no se anula desde transacciones

## Intención

INV-016 sincrónico: la imputación y la transacción no pueden divergir (design decisión 10).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR anula desde transacciones el pago de 2342.02 BOB del "Préstamo vehicular"
Entonces se rechaza con `TRANSACTION_MANAGED_EXTERNALLY` y la transacción sigue vigente
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
