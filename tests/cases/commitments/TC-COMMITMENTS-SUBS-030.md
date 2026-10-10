---
id: TC-COMMITMENTS-SUBS-030
title: 'La renovación próxima crea una notificación por miembro y una sola aunque el hecho se reentregue'
spec: notifications/alerts
related_specs: ['commitments/subscriptions']
requirement: 'Notificación de renovación próxima de una suscripción'
scenario: 'Renovación de Streamly'
requirement_status: provisional
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-001', 'FR-COMMITMENTS-016']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['notifications', 'subscriptions', 'dedup']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Miembros activos OWNER, EDITOR y VIEWER con preferencias por defecto'
input:
  event: 'commitments.SubscriptionRenewalUpcoming.v1'
  provider: 'Streamly'
  renewalDate: '2026-11-15'
  expectedPrice: '10.99 USD'
  paymentAccount: 'Visa USD'
steps:
  - 'Entregar el hecho'
  - 'Entregarlo otra vez con el mismo y con otro eventId'
expected_result:
  - 'Cada miembro tiene una notificación UNREAD SUBSCRIPTION_RENEWAL de "Streamly" 2026-11-15 10.99 USD "Visa USD" con enlace a la suscripción'
  - 'Las reentregas no crean notificaciones nuevas (dedupe subscription-renewal:<id>:2026-11-15)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-030 — La renovación próxima crea una notificación por miembro y una sola aunque el hecho se reentregue

## Intención

FR-NOTIFY-004 tipos de Phase 3; FR-NOTIFY-005 idempotencia.

## Escenario

```gherkin
Dado OWNER, EDITOR y VIEWER activos
Cuando se publica la renovación de "Streamly" del 2026-11-15
Entonces cada uno tiene una notificación
  Y una reentrega no crea otra
```

## Notas

- Cubre el scenario "Hecho reentregado".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
