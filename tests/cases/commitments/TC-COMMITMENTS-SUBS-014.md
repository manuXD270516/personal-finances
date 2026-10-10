---
id: TC-COMMITMENTS-SUBS-014
title: 'Un precio con vigencia anterior a la última entrada se rechaza'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Cambio de precio manual aplicado a renovaciones futuras'
scenario: 'Vigencia anterior a la última'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-013']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/price-history.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'price-history']
error_code: 'SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL'
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" con última entrada 12.99 USD desde 2027-03-15'
input:
  price: '11.99 USD'
  effectiveFrom: '2027-01-15'
steps:
  - 'Registrar el precio'
expected_result:
  - 'Rechazo SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL'
  - 'Historial sin cambios y sin evento'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-014 — Un precio con vigencia anterior a la última entrada se rechaza

## Intención

Orden y ausencia de solapes del historial (docs/04 §3.7).

## Escenario

```gherkin
Dado la última entrada desde 2027-03-15
Cuando registro 11.99 USD desde 2027-01-15
Entonces se rechaza con SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
