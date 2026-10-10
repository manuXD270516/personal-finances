---
id: TC-COMMITMENTS-RECUR-043
title: 'Una ocurrencia por aprobar notifica a OWNER y EDITOR sin monto en el email'
spec: notifications/alerts
related_specs: [commitments/recurrence-engine]
requirement: 'Aviso de pago próximo u ocurrencia por aprobar'
scenario: 'Alquiler por aprobar notificado'
requirement_status: confirmed
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-006']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/dispatch-email-delivery.test.ts
  - packages/contexts/notifications/src/application/notify-from-event.test.ts
  - packages/contexts/notifications/src/domain/render.test.ts
  - packages/contexts/notifications/src/domain/type-catalog.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['notifications', 'recurrence']
error_code: null
preconditions:
  - 'Workspace con OWNER, EDITOR y VIEWER activos; email habilitado sin opt-in de montos'
input:
  event: 'RecurringOccurrenceDue.v1 Alquiler 2026-11-05 requiresApproval true'
steps:
  - 'Entregar el evento al consumidor notifications.occurrence-due'
expected_result:
  - 'OWNER y EDITOR con notificación RECURRING_APPROVAL_REQUIRED enlazada a la ocurrencia'
  - 'El VIEWER no recibe'
  - 'El email no contiene 3500.00'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-043 — Una ocurrencia por aprobar notifica a OWNER y EDITOR sin monto en el email

## Intención

FR-NOTIFY-004 (tipo Phase 3) con FR-NOTIFY-006.

## Escenario

```gherkin
Dado la ocurrencia del 2026-11-05 del "Alquiler" en aprobación pendiente
Cuando pasa a próxima
Entonces el OWNER y el EDITOR reciben "ocurrencia por aprobar"
  Y el email no muestra 3500.00 BOB
```

## Notas

- Depende de la pregunta abierta 7 (destinatarios).
