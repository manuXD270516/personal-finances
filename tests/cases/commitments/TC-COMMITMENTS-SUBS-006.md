---
id: TC-COMMITMENTS-SUBS-006
title: 'Cambiar la tarjeta de pago aplica desde la fecha de efecto sin tocar la transacción anterior'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Editar una suscripción sin alterar el pasado'
scenario: 'Cambio de tarjeta desde la próxima renovación'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-COMMITMENTS-009']
nfr: []
invariants: ['INV-012', 'INV-029']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'change-future']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa USD" (credit_card, USD) activa'
  - 'Cuenta "Visa BOB" (credit_card, BOB) activa'
  - '"Streamly" 10.99 USD mensual (día 15) con transacción de 10.99 USD del 2026-10-15 en "Visa USD"'
input:
  paymentAccountId: 'Visa BOB'
  effectiveFrom: '2026-11-15'
steps:
  - 'PATCH de la suscripción con If-Match'
expected_result:
  - 'La ocurrencia del 2026-11-15 es en "Visa BOB" (estimada en BOB)'
  - 'La transacción del 2026-10-15 sigue en "Visa USD" por 10.99 USD'
  - 'Auditoría con diff de la cuenta de pago'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-006 — Cambiar la tarjeta de pago aplica desde la fecha de efecto sin tocar la transacción anterior

## Intención

FR-COMMITMENTS-009: los cambios de la definición nunca alteran el pasado.

## Escenario

```gherkin
Dado "Streamly" pagada con "Visa USD" el 2026-10-15
Cuando cambio la cuenta a "Visa BOB" desde 2026-11-15
Entonces el cargo del 2026-11-15 es en "Visa BOB"
  Y la transacción del 2026-10-15 no cambia
```

## Notas

- Incluye el scenario "Suscripción cancelada no editable" (INVALID_STATUS_TRANSITION).
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
