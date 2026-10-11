---
id: TC-DEBT-CARD-001
title: 'Registrar una tarjeta en BOB no crea asientos'
spec: debt/credit-cards
related_specs: []
requirement: 'Registro de una tarjeta de crédito'
scenario: 'Tarjeta en bolivianos'
requirement_status: confirmed
fr: ['FR-DEBT-012']
nfr: []
invariants: ['INV-030', 'INV-029']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
  - tests/e2e/specs/credit-cards.spec.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'create']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa Oro BOB" (credit_card, BOB) activa que adeuda 1200.00 BOB'
  - 'Usuario EDITOR'
input:
  name: 'Visa Oro'
  account: 'Visa Oro BOB'
  creditLimit: '10000.00 BOB'
  statementDay: '25'
  dueDay: '15'
  minimumRule: 'PERCENT 5.00 floor 50.00 BOB'
steps:
  - 'Registrar la tarjeta como EDITOR con Idempotency-Key'
expected_result:
  - 'Tarjeta "Visa Oro" ACTIVE con esos términos'
  - '"Visa Oro BOB" sigue adeudando 1200.00 BOB'
  - 'Ningún asiento nuevo en el ledger'
  - 'Auditoría debt.credit_card.created en la misma transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-001 — Registrar una tarjeta en BOB no crea asientos

## Intención

FR-DEBT-012: la tarjeta es un perfil sobre una cuenta LIABILITY existente; registrarla no debe tocar el ledger (Debt nunca escribe asientos).

## Escenario

```gherkin
Dado la cuenta "Visa Oro BOB" que adeuda 1200.00 BOB
Cuando registro "Visa Oro" con límite 10000.00 BOB, cierre 25 y vencimiento 15
Entonces la tarjeta queda activa
  Y "Visa Oro BOB" sigue adeudando 1200.00 BOB sin asientos nuevos
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
