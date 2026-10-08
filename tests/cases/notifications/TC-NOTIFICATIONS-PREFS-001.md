---
id: TC-NOTIFICATIONS-PREFS-001
title: 'Desactivar el email de umbrales deja solo la notificación in-app'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Preferencias por tipo y canal'
scenario: 'Solo in-app para umbrales'
requirement_status: confirmed
fr: ['FR-NOTIFY-003']
nfr: []
invariants: ['INV-029']
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/notifications.api.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/notify-from-event.test.ts
  - packages/contexts/notifications/src/application/preferences.service.test.ts
  - packages/contexts/notifications/src/domain/preferences.test.ts
  - packages/contexts/notifications/test/integration/pg-notifications.int.test.ts
  - tests/e2e/specs/notifications.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ['notifications', 'preferences', 'audit']
error_code: null
preconditions:
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'Mailpit'
input:
  preferences: 'BUDGET_THRESHOLD: inApp true, email false'
  event: 'umbral 100 % de Restaurantes'
steps:
  - 'PUT notification-preferences'
  - 'Procesar el evento'
expected_result:
  - 'El OWNER tiene la notificación in-app'
  - 'Mailpit no recibe email'
  - 'El cambio de preferencias queda auditado'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-PREFS-001 — Desactivar el email de umbrales deja solo la notificación in-app

## Intención

FR-NOTIFY-003 (Should).

## Escenario

```gherkin
Dado el OWNER con el email de umbrales desactivado
Cuando se publica el umbral 100 %
Entonces recibe la notificación in-app y ningún email
```

## Notas

