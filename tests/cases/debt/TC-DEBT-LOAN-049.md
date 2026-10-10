---
id: TC-DEBT-LOAN-049
title: 'Un prepago con cuotas vencidas impagas se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Registrar un pago extraordinario'
scenario: 'Prepago con una cuota vencida sin pagar'
requirement_status: provisional
fr: ['FR-DEBT-008']
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
tags: ['loans', 'prepayment', 'validation']
error_code: LOAN_INSTALLMENTS_PENDING
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'La cuota 4 del 2027-02-15 no está pagada y el EDITOR registra un pago extraordinario con fecha 2027-02-20'
expected_result:
  - 'Se rechaza con `LOAN_INSTALLMENTS_PENDING` y no se crea ninguna transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-049 — Un prepago con cuotas vencidas impagas se rechaza

## Intención

Precondición de frontera de periodo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la cuota 4 del 2027-02-15 no está pagada y el EDITOR registra un pago extraordinario con fecha 2027-02-20
Entonces se rechaza con `LOAN_INSTALLMENTS_PENDING` y no se crea ninguna transacción
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
