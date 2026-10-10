---
id: TC-COMMITMENTS-SUBS-024
title: 'Un cargo en BOB de una suscripción en USD registra la tasa implícita y detecta solo con el monto del extracto'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Cargos en una moneda distinta del precio'
scenario: 'Monto en USD del extracto'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-014', 'FR-COMMITMENTS-012']
nfr: []
invariants: ['INV-002']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/pricing.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'fx', 'price-detection']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa BOB" (credit_card, BOB) activa'
  - '"Streamly" 10.99 USD pagada con "Visa BOB"'
input:
  charge: '108.50 BOB del 2026-11-15'
  priceCurrencyAmount: '12.99 USD'
steps:
  - 'Vincular el cargo del 2026-11-15 a una transacción de 108.50 BOB'
  - 'PATCH del cargo con priceCurrencyAmount 12.99 USD'
expected_result:
  - 'Tras vincular: outcome NOT_COMPARABLE, tasa implícita 9.8726 BOB por USD, sin propuesta ni evento'
  - 'Tras indicar 12.99 USD: propuesta PENDING 12.99 USD desde 2026-11-15, "+18.20"'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-024 — Un cargo en BOB de una suscripción en USD registra la tasa implícita y detecta solo con el monto del extracto

## Intención

Exit criterion "precios que cambian con el tipo de cambio": la variación cambiaria no es un cambio de precio (pregunta 3).

## Escenario

```gherkin
Dado "Streamly" a 10.99 USD con "Visa BOB"
Cuando su cargo se vincula a 108.50 BOB
Entonces el cargo es no comparable con tasa implícita 9.8726
Cuando indico 12.99 USD del extracto
Entonces hay una propuesta de 12.99 USD "+18.20"
```

## Notas

- Cubre también el scenario "Cargo en BOB sin monto original".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
