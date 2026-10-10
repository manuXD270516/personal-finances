---
id: TC-COMMITMENTS-SUBS-022
title: 'La detección es idempotente ante eventos reentregados y procesamiento concurrente'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Detección de cambio de precio con tolerancia'
scenario: 'Vinculación recibida dos veces'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-014']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/test/integration/pg-subscriptions.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'idempotency', 'concurrency']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"MusicBox" 9.99 USD'
input:
  deliveries: ['mismo eventId dos veces', 'otro eventId con la misma ocurrencia', 'dos workers en paralelo']
steps:
  - 'Entregar los eventos de vinculación del cargo del 2026-11-05 a 11.99 USD'
expected_result:
  - 'Un solo subscription_charge'
  - 'Una sola propuesta'
  - 'Un solo SubscriptionPriceChanged.v1 en el outbox'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-022 — La detección es idempotente ante eventos reentregados y procesamiento concurrente

## Intención

Exactly-once en el productor: inbox + UNIQUE de negocio (subscription, ocurrencia) y (subscription, vigencia).

## Escenario

```gherkin
Cuando el hecho de vinculación del cargo del 2026-11-05 llega dos veces
Entonces existe una sola propuesta
  Y se publicó un solo cambio de precio
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
