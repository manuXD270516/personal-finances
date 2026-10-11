---
id: TC-DEBT-CARD-009
title: 'Resumen del ciclo de octubre cuadra con el saldo al cierre'
spec: debt/credit-cards
related_specs: []
requirement: 'Resumen del ciclo y saldo al cierre'
scenario: 'Ciclo de octubre de Visa Oro BOB'
requirement_status: confirmed
fr: ['FR-DEBT-013', 'FR-LEDGER-012']
nfr: []
invariants: ['INV-022', 'INV-001']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/card-cycle-calculator.test.ts
  - packages/contexts/transactions/src/domain/account-movements.test.ts
  - packages/contexts/transactions/test/integration/pg-account-movements.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'cycle']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
input:
  cycle: '2026-09-26..2026-10-25'
steps:
  - 'Calcular el ciclo de "Visa Oro BOB"'
expected_result:
  - 'Saldo anterior 1200.00, compras 1170.50, reembolsos 50.00, pagos 1200.00, saldo al cierre 1120.50 BOB'
  - 'Cuadre anterior + compras − reembolsos − pagos ± otros = cierre'
  - 'La compra de 400.00 BOB del 2026-10-26 pertenece al ciclo siguiente'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-009 — Resumen del ciclo de octubre cuadra con el saldo al cierre

## Intención

FR-DEBT-013: las cifras del ciclo se derivan del ledger y deben cuadrar con el saldo a la fecha de cierre.

## Escenario

```gherkin
Dado los movimientos de octubre de "Visa Oro BOB"
Cuando calculo el ciclo que cierra el 2026-10-25
Entonces el saldo al cierre es 1120.50 BOB con compras 1170.50 y pagos 1200.00
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
