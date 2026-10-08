---
id: TC-NOTIFICATIONS-INAPP-004
title: 'Marcar todas como leídas deja el contador en cero'
spec: notifications/alerts
related_specs: []
requirement: 'Centro de notificaciones con estados y contador'
scenario: 'Marcar todas como leídas'
requirement_status: confirmed
fr: ['FR-NOTIFY-001']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/notifications.api.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/inbox.test.ts
  - packages/contexts/notifications/src/domain/notification.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['notifications', 'inbox']
error_code: null
preconditions:
  - 'Estado final de TC-NOTIFICATIONS-INAPP-003'
input:
  action: 'POST read-all'
steps:
  - 'Marcar todas como leídas'
  - 'Consultar el contador'
expected_result:
  - 'unread = 0'
  - 'La respuesta informa updated = 1'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-INAPP-004 — Marcar todas como leídas deja el contador en cero

## Intención

FR-NOTIFY-001.

## Escenario

```gherkin
Cuando marco todas como leídas
Entonces el contador de no leídas es 0
```

## Notas

