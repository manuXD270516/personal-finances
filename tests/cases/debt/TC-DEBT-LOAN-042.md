---
id: TC-DEBT-LOAN-042
title: 'Los datos descriptivos del pago siguen editables sin tocar el ledger'
spec: transactions/transaction-recording
related_specs: ['debt/loans']
requirement: 'Transacciones de préstamo administradas por el préstamo'
scenario: 'Agregar una nota al pago'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['transactions', 'loans']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR agrega la nota "pagado en ventanilla" al pago de 2342.02 BOB'
expected_result:
  - 'La nota queda registrada y el asiento del pago no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-042 — Los datos descriptivos del pago siguen editables sin tocar el ledger

## Intención

La protección es solo financiera; notas y tags se editan normalmente.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR agrega la nota "pagado en ventanilla" al pago de 2342.02 BOB
Entonces la nota queda registrada y el asiento del pago no cambia
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
