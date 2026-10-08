---
id: TC-NOTIFICATIONS-EMAIL-006
title: 'Con el proveedor caído se reintenta 5 veces sin afectar la notificación in-app'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Reintentos de email sin afectar el in-app'
scenario: 'Proveedor caído'
requirement_status: confirmed
fr: ['FR-NOTIFY-002']
nfr: ['NFR-REL-008']
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/events/notifications.int.test.ts
  - packages/contexts/notifications/src/application/dispatch-email-delivery.test.ts
  - packages/contexts/notifications/test/integration/pg-notifications.int.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['notifications', 'email', 'retries', 'observability']
error_code: null
preconditions:
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'Doble de EmailSender que devuelve error reintentable siempre'
  - 'NOTIFY_EMAIL_MAX_ATTEMPTS = 5'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento'
  - 'Avanzar el reloj por los backoffs (1 min, 5 min, 25 min, 2 h)'
expected_result:
  - '5 intentos y la entrega queda FAILED'
  - 'notifications_email_deliveries_total{status="failed"} incrementa en 1'
  - 'La notificación in-app existe UNREAD desde el primer intento'
  - 'Los logs no contienen la dirección de email'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-EMAIL-006 — Con el proveedor caído se reintenta 5 veces sin afectar la notificación in-app

## Intención

FR-NOTIFY-002: el email nunca bloquea el in-app; fallas observables.

## Escenario

```gherkin
Dado el proveedor de email caído
Cuando se publica el umbral 90 %
Entonces el email se reintenta 5 veces y queda fallido
  Y la notificación in-app existe desde el principio
```

## Notas

