---
id: TC-COMMITMENTS-SUBS-015
title: 'Cancelar finaliza la definición y conserva transacciones e historial'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Cancelar una suscripción sin afectar el pasado'
scenario: 'Cancelación con historia'
requirement_status: provisional
fr: ['FR-COMMITMENTS-017']
nfr: []
invariants: ['INV-012', 'INV-029']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'cancel', 'events']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa USD" (credit_card, USD) activa'
  - '"Streamly" con transacciones de 10.99 USD del 2026-09-15 y 2026-10-15 y ocurrencia no resuelta del 2026-11-15'
input:
  effectiveOn: '2026-11-02'
  reason: 'Ya no la uso'
steps:
  - 'POST W/subscriptions/{id}/cancel con If-Match'
  - 'Repetir la cancelación'
expected_result:
  - '"Streamly" CANCELLED con fecha 2026-11-02 y sin próxima renovación'
  - 'La ocurrencia del 2026-11-15 queda CANCELLED (ENDED); definición finalizada'
  - 'Transacciones del 2026-09-15 y 2026-10-15 intactas (10.99 USD c/u, mismos asientos)'
  - 'Outbox: commitments.SubscriptionCancelled.v1'
  - 'La segunda cancelación ⇒ INVALID_STATUS_TRANSITION'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-015 — Cancelar finaliza la definición y conserva transacciones e historial

## Intención

FR-COMMITMENTS-017: cancelar nunca afecta transacciones pasadas.

## Escenario

```gherkin
Dado "Streamly" con dos pagos registrados y un cargo pendiente
Cuando la cancelo el 2026-11-02
Entonces queda cancelada sin cargo pendiente
  Y los dos pagos siguen registrados
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
