---
id: TC-COMMITMENTS-SUBS-023
title: 'Aceptar una propuesta agrega el precio al historial y rechazarla no lo cambia'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Aceptar o rechazar una propuesta de precio'
scenario: 'Aceptar el aumento detectado'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-014', 'FR-COMMITMENTS-013']
nfr: []
invariants: ['INV-012']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'price-proposal']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"MusicBox" 9.99 USD con propuesta PENDING 11.99 USD desde 2026-11-05'
input:
  actions: ['accept', 'reject (otro escenario)', 'accept tras reject']
steps:
  - 'Aceptar la propuesta'
  - 'En otro escenario: rechazarla y luego intentar aceptarla'
expected_result:
  - 'Aceptar: historial 9.99 y 11.99 desde 2026-11-05 (origin PROPOSAL); ocurrencia del 2026-12-05 de 11.99 USD; sin segundo SubscriptionPriceChanged'
  - 'Rechazar: precio vigente 9.99 USD, propuesta REJECTED'
  - 'Aceptar tras rechazar ⇒ SUBSCRIPTION_PROPOSAL_NOT_PENDING'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-023 — Aceptar una propuesta agrega el precio al historial y rechazarla no lo cambia

## Intención

FR-COMMITMENTS-014: proponer, no imponer; el usuario confirma el precio nuevo.

## Escenario

```gherkin
Dado la propuesta de 11.99 USD de "MusicBox"
Cuando la acepto
Entonces el historial tiene 11.99 USD desde 2026-11-05
  Y el cargo del 2026-12-05 es de 11.99 USD
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
