---
id: TC-COMMITMENTS-SUBS-020
title: 'Un cargo que supera la tolerancia crea una propuesta y publica el cambio de precio detectado'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Detección de cambio de precio con tolerancia'
scenario: 'Aumento detectado en el cargo'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-014']
nfr: []
invariants: ['INV-028']
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
tags: ['subscriptions', 'price-detection', 'events']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa USD" (credit_card, USD) activa'
  - '"MusicBox" 9.99 USD (tolerancia 1.00 %) pagada con "Visa USD"'
input:
  event: 'RecurringOccurrenceMaterialized.v1'
  occurrenceDate: '2026-11-05'
  transactionAmount: '11.99 USD'
steps:
  - 'Entregar el evento al consumidor commitments.subscription-charges'
expected_result:
  - 'subscription_charge con desvío 20.02 y outcome PRICE_CHANGE_DETECTED'
  - 'Propuesta PENDING 11.99 USD desde 2026-11-05'
  - 'Outbox: SubscriptionPriceChanged.v1 origin DETECTED, 9.99 → 11.99 USD, "+20.02"'
  - 'Precio vigente sigue 9.99 USD'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-020 — Un cargo que supera la tolerancia crea una propuesta y publica el cambio de precio detectado

## Intención

FR-COMMITMENTS-014: detectar aumentos silenciosos del provider.

## Escenario

```gherkin
Dado "MusicBox" a 9.99 USD
Cuando su cargo del 2026-11-05 se vincula a 11.99 USD
Entonces hay una propuesta de 11.99 USD desde 2026-11-05
  Y se publica el cambio detectado "+20.02"
  Y el precio vigente sigue en 9.99 USD
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
