---
id: TC-DEBT-CARD-027
title: 'Archivar la tarjeta termina su plan y conserva la historia'
spec: debt/credit-cards
related_specs: []
requirement: 'Archivar una tarjeta'
scenario: 'Tarjeta reemplazada por el banco'
requirement_status: confirmed
fr: ['FR-DEBT-012']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'archive']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Plan de pago activo en "Visa Oro BOB"'
input:
  action: 'archive'
steps:
  - 'Archivar "Visa Oro"'
  - 'Registrar otra tarjeta con "Visa Oro BOB"'
expected_result:
  - 'Plan terminado; estados de cuenta consultables'
  - '"Visa Oro BOB" conserva saldo y estado activo'
  - 'La cuenta puede vincularse a otra tarjeta'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-027 — Archivar la tarjeta termina su plan y conserva la historia

## Intención

Archivar no toca cuentas ni ledger.

## Escenario

```gherkin
Dado "Visa Oro" con plan de pago
Cuando la archivo
Entonces el plan termina y la cuenta conserva su saldo
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
