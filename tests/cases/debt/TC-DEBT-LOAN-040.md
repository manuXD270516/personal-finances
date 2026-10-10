---
id: TC-DEBT-LOAN-040
title: 'El pago de préstamo aparece en transacciones con su desglose y préstamo'
spec: transactions/transaction-recording
related_specs: ['debt/loans']
requirement: 'Transacciones de préstamo administradas por el préstamo'
scenario: 'Pago de préstamo en el listado'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: []
priority: high
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
  - 'El usuario filtra las transacciones de noviembre de 2026 por tipo pago de préstamo'
expected_result:
  - 'Ve el pago de 2342.02 BOB del 2026-11-15 desde "Banco BOB" con principal 1862.85 BOB e interés 479.17 BOB y el préstamo "Préstamo vehicular"'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-040 — El pago de préstamo aparece en transacciones con su desglose y préstamo

## Intención

Las transacciones de préstamo son ciudadanas del listado aunque se administren en el préstamo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el usuario filtra las transacciones de noviembre de 2026 por tipo pago de préstamo
Entonces ve el pago de 2342.02 BOB del 2026-11-15 desde "Banco BOB" con principal 1862.85 BOB e interés 479.17 BOB y el préstamo "Préstamo vehicular"
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
