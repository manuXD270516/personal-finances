---
id: TC-NOTIFICATIONS-INAPP-003
title: 'Leer y archivar actualizan la bandeja y el contador de no leídas'
spec: notifications/alerts
related_specs: []
requirement: 'Centro de notificaciones con estados y contador'
scenario: 'Leer y archivar'
requirement_status: confirmed
fr: ['FR-NOTIFY-001']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/notifications.api.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/inbox.test.ts
  - packages/contexts/notifications/src/domain/notification.test.ts
  - packages/contexts/notifications/test/integration/pg-notifications.int.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['notifications', 'inbox']
error_code: null
preconditions:
  - 'Workspace "W1 Personal Demo" con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - 'El OWNER tiene 3 notificaciones UNREAD'
input:
  read: 'notificación A'
  archive: 'notificación B'
steps:
  - 'Marcar A como leída'
  - 'Archivar B'
  - 'Consultar el contador'
  - 'Listar por defecto y con status=ARCHIVED'
expected_result:
  - 'unread = 1'
  - 'La lista por defecto tiene 2 notificaciones (A leída y C no leída), de la más reciente a la más antigua'
  - 'B aparece solo con status=ARCHIVED'
  - 'Repetir "leer" sobre A responde igual (idempotente)'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-INAPP-003 — Leer y archivar actualizan la bandeja y el contador de no leídas

## Intención

FR-NOTIFY-001: estados unread/read/archived y contador.

## Escenario

```gherkin
Dado 3 notificaciones no leídas
Cuando marco una como leída y archivo otra
Entonces el contador es 1
  Y la archivada solo aparece al filtrar por archivadas
```

## Notas

