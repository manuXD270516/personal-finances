---
id: TC-DEBT-CARD-010
title: 'Una compra pendiente no cuenta en el ciclo'
spec: debt/credit-cards
related_specs: []
requirement: 'Resumen del ciclo y saldo al cierre'
scenario: 'Compra pendiente fuera del ciclo'
requirement_status: confirmed
fr: ['FR-DEBT-013', 'FR-LEDGER-013']
nfr: []
invariants: ['INV-023']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/card-cycle-calculator.test.ts
  - packages/contexts/transactions/test/integration/pg-account-movements.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'pending']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
  - 'Compra PENDING de 75.00 BOB del 2026-10-22 en "Visa Oro BOB"'
input:
  cycle: '2026-09-26..2026-10-25'
steps:
  - 'Calcular el ciclo'
expected_result:
  - 'Saldo al cierre 1120.50 BOB'
  - 'Compras 1170.50 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-010 — Una compra pendiente no cuenta en el ciclo

## Intención

Las pendientes no tienen asiento (INV-023) y no se facturan.

## Escenario

```gherkin
Dado una compra pendiente de 75.00 BOB en el ciclo
Cuando calculo el ciclo
Entonces el saldo al cierre sigue en 1120.50 BOB
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
