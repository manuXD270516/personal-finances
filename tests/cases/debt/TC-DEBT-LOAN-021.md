---
id: TC-DEBT-LOAN-021
title: 'Solo el pago más reciente puede anularse'
spec: debt/loans
related_specs: []
requirement: 'Anular un pago de préstamo'
scenario: 'Anular un pago anterior'
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
tags: ['loans', 'payment', 'void']
error_code: LOAN_PAYMENT_NOT_LATEST
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Las cuotas 1 y 2 se pagaron con dos pagos y el EDITOR anula el pago de la cuota 1'
expected_result:
  - 'Se rechaza con `LOAN_PAYMENT_NOT_LATEST` y ambos pagos siguen vigentes'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-021 — Solo el pago más reciente puede anularse

## Intención

Anular un pago intermedio obligaría a re-imputar los posteriores; se prohíbe (design decisión 8).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando las cuotas 1 y 2 se pagaron con dos pagos y el EDITOR anula el pago de la cuota 1
Entonces se rechaza con `LOAN_PAYMENT_NOT_LATEST` y ambos pagos siguen vigentes
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
