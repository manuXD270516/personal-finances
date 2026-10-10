---
id: TC-DEBT-LOAN-016
title: 'Un pago mayor que todo lo pendiente se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Diferencias entre el pago real y la cuota esperada'
scenario: 'Pago mayor que la deuda'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'payment', 'validation']
error_code: LOAN_OVERPAYMENT
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 1000.00 BOB a 3 cuotas solo tiene pendiente la cuota 3 de 340.03 BOB y el EDITOR registra un pago de 500.00 BOB'
expected_result:
  - 'Se rechaza con `LOAN_OVERPAYMENT` y no se crea ninguna transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-016 — Un pago mayor que todo lo pendiente se rechaza

## Intención

Un sobrepago dejaría la cuenta de pasivo con saldo a favor y el principal por debajo de cero.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 1000.00 BOB a 3 cuotas solo tiene pendiente la cuota 3 de 340.03 BOB y el EDITOR registra un pago de 500.00 BOB
Entonces se rechaza con `LOAN_OVERPAYMENT` y no se crea ninguna transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
