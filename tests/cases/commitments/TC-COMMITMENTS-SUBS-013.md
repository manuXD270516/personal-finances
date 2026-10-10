---
id: TC-COMMITMENTS-SUBS-013
title: 'Un cambio de precio manual aplica a renovaciones futuras y publica el hecho con origen manual'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Cambio de precio manual aplicado a renovaciones futuras'
scenario: 'Aumento anunciado por el provider'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-013', 'FR-COMMITMENTS-009']
nfr: []
invariants: ['INV-012']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/price-history.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'price-change', 'events']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa USD" (credit_card, USD) activa'
  - '"Streamly" 10.99 USD desde 2026-11-15 con transacción del 2026-11-15 por 10.99 USD'
input:
  price: '12.99 USD'
  effectiveFrom: '2027-03-15'
steps:
  - 'POST W/subscriptions/{id}/prices con Idempotency-Key'
expected_result:
  - 'Historial: 10.99 desde 2026-11-15 y 12.99 desde 2027-03-15'
  - 'Ocurrencia del 2027-03-15 de 12.99 USD; la transacción del 2026-11-15 sigue en 10.99 USD'
  - 'Outbox: commitments.SubscriptionPriceChanged.v1 origin MANUAL, previous 10.99 USD, new 12.99 USD, changePercentage "+18.20"'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-013 — Un cambio de precio manual aplica a renovaciones futuras y publica el hecho con origen manual

## Intención

Registrar un aumento anunciado mantiene correctos Q4/Q8 sin reescribir la historia.

## Escenario

```gherkin
Dado "Streamly" a 10.99 USD con el cargo de noviembre registrado
Cuando registro 12.99 USD desde 2027-03-15
Entonces el cargo del 2027-03-15 es de 12.99 USD
  Y la transacción de noviembre sigue en 10.99 USD
  Y se publica el cambio de precio "+18.20"
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
