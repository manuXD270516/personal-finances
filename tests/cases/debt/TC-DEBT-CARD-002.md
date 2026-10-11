---
id: TC-DEBT-CARD-002
title: 'El registro rechaza cuentas inválidas, ya vinculadas y días fuera de rango'
spec: debt/credit-cards
related_specs: []
requirement: 'Registro de una tarjeta de crédito'
scenario: 'Cuenta bancaria como tarjeta'
requirement_status: confirmed
fr: ['FR-DEBT-012']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/web/src/ui/debt/cards/logic.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'validation']
error_code: CREDIT_CARD_ACCOUNT_INVALID
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Banco BOB" (bank, BOB, LIQUID) activa'
  - '"Visa Oro BOB" ya pertenece a la tarjeta activa "Visa Oro"'
input:
  caseA: 'cuenta Banco BOB (bank)'
  caseB: 'cuenta Visa Oro BOB para "Visa Oro 2"'
  caseC: 'statementDay 32'
steps:
  - 'Registrar una tarjeta con "Banco BOB"'
  - 'Registrar "Visa Oro 2" con "Visa Oro BOB"'
  - 'Registrar una tarjeta con cierre el día 32'
expected_result:
  - 'A: 422 CREDIT_CARD_ACCOUNT_INVALID'
  - 'B: 409 CREDIT_CARD_ACCOUNT_IN_USE'
  - 'C: 400 VALIDATION_FAILED'
  - 'Ninguna tarjeta nueva creada'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-002 — El registro rechaza cuentas inválidas, ya vinculadas y días fuera de rango

## Intención

Protege la regla una cuenta credit_card → a lo sumo una tarjeta activa y el rango de días 1–31.

## Escenario

```gherkin
Dado "Banco BOB" de tipo bank y "Visa Oro BOB" ya vinculada
Cuando registro tarjetas con esas cuentas o con cierre 32
Entonces cada registro se rechaza con su código
  Y no se crea ninguna tarjeta
```

## Notas

- Cubre también los scenarios "Cuenta ya vinculada" y "Día de cierre inválido".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
