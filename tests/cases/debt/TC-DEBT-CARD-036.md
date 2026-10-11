---
id: TC-DEBT-CARD-036
title: 'Sin aviso genérico de pago próximo para el pago de tarjeta sin aprobación'
spec: notifications/alerts
related_specs: ['debt/credit-cards', 'commitments/recurrence-engine']
requirement: 'Sin doble aviso del pago de tarjeta'
scenario: 'Plan en modo solo aviso'
requirement_status: confirmed
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-005']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/card-notifications.test.ts
status: automated
regression_suite: true
phase: 4
tags: ['notifications', 'dedupe']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Planes de pago de Visa Oro BOB en NOTIFY_ONLY y en PENDING_APPROVAL'
input:
  event: 'RecurringOccurrenceDue.v1 kind CARD_PAYMENT managedBy DEBT'
steps:
  - 'Procesar el hecho con requiresApproval=false'
  - 'Procesar el hecho con requiresApproval=true'
expected_result:
  - 'Sin notificación genérica de pago próximo'
  - 'Notificación "ocurrencia por aprobar" a OWNER y EDITOR'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-036 — Sin aviso genérico de pago próximo para el pago de tarjeta sin aprobación

## Intención

D119 aplicado a tarjetas: el vencimiento lo avisa CARD_PAYMENT_DUE.

## Escenario

```gherkin
Dado la ocurrencia del pago de "Visa Oro BOB" en solo aviso
Cuando pasa a próxima
Entonces no se crea la notificación genérica de pago próximo
```

## Notas

- Cubre "Plan con aprobación pendiente".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
