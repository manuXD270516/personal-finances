---
id: TC-DEBT-LOAN-030
title: 'Un movimiento manual en la cuenta del préstamo aparece como diferencia no registrada'
spec: debt/loans
related_specs: ['transactions/transfers']
requirement: 'Detalle y estado del préstamo'
scenario: 'Transferencia manual a la cuenta del préstamo'
requirement_status: confirmed
fr: ['FR-DEBT-007']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'detail', 'reconciliation']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Además el usuario transfiere a mano 1000.00 BOB de "Banco BOB" a "Préstamo vehicular" fuera del préstamo'
expected_result:
  - 'El saldo adeudado de la cuenta es 47137.15 BOB, el principal pendiente sigue en 48137.15 BOB y el detalle informa una diferencia de 1000.00 BOB no registrada como pago'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-030 — Un movimiento manual en la cuenta del préstamo aparece como diferencia no registrada

## Intención

Pregunta 6 de design: los movimientos fuera del préstamo se permiten pero se hacen visibles.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando además el usuario transfiere a mano 1000.00 BOB de "Banco BOB" a "Préstamo vehicular" fuera del préstamo
Entonces el saldo adeudado de la cuenta es 47137.15 BOB, el principal pendiente sigue en 48137.15 BOB y el detalle informa una diferencia de 1000.00 BOB no registrada como pago
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
