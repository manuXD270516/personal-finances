---
id: TC-DEBT-CARD-003
title: 'Una tarjeta bimoneda informa un estado de cuenta por moneda'
spec: debt/credit-cards
related_specs: []
requirement: 'Tarjeta bimoneda con una cuenta por moneda'
scenario: 'Visa Oro en BOB y USD'
requirement_status: confirmed
fr: ['FR-DEBT-016']
nfr: []
invariants: ['INV-002']
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/api/test/api/workspace-import.api.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'multi-currency']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuentas "Visa Oro BOB" (credit_card, BOB) y "Visa Oro USD" (credit_card, USD) activas'
input:
  accounts: 'Visa Oro BOB (5.00 % piso 50.00 BOB), Visa Oro USD (5.00 % piso 10.00 USD)'
  statementDay: '25'
  dueDay: '15'
steps:
  - 'Registrar "Visa Oro" con ambas cuentas'
  - 'Consultar el ciclo que cierra el 2026-10-25'
expected_result:
  - 'Dos cuentas con cierre 2026-10-25 y vencimiento 2026-11-15'
  - 'Un estado de cuenta en BOB y otro en USD, sin sumar monedas'
  - 'Dos cuentas en la misma moneda ⇒ CREDIT_CARD_ACCOUNT_INVALID'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-003 — Una tarjeta bimoneda informa un estado de cuenta por moneda

## Intención

FR-DEBT-016: una tarjeta con una cuenta LIABILITY por moneda, calendario compartido y cálculos por moneda (INV-002).

## Escenario

```gherkin
Dado "Visa Oro BOB" y "Visa Oro USD"
Cuando registro "Visa Oro" con ambas
Entonces el ciclo del 2026-10-25 tiene un estado de cuenta en BOB y otro en USD
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
