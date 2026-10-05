---
id: TC-NOTIFICATIONS-INAPP-006
title: 'Un usuario no puede ver ni modificar notificaciones de otro usuario o workspace'
spec: notifications/alerts
related_specs: ['security/access-control']
requirement: 'Notificaciones privadas de cada usuario'
scenario: 'Notificación de otro miembro'
requirement_status: provisional
fr: ['FR-NOTIFY-001']
nfr: ['NFR-SEC-003', 'NFR-SEC-004']
invariants: ['INV-025']
priority: critical
type: security
level: security
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'rls', 'privacy']
error_code: RESOURCE_NOT_FOUND
preconditions:
  - 'PostgreSQL real con RLS'
  - 'OWNER y VIEWER en W1; usuario de otro workspace W2'
  - 'Notificación N del OWNER no leída'
input:
  target: 'N'
steps:
  - 'El VIEWER marca N como leída'
  - 'El usuario de W2 consulta N'
  - 'Consulta SQL como pf_app con app.user_id del VIEWER'
expected_result:
  - 'Ambas operaciones responden 404 RESOURCE_NOT_FOUND'
  - 'N sigue UNREAD'
  - 'La consulta SQL no devuelve N; sin app.user_id falla con PF002'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-INAPP-006 — Un usuario no puede ver ni modificar notificaciones de otro usuario o workspace

## Intención

Privacidad por usuario además del aislamiento por workspace (RLS, ADR-0023).

## Escenario

```gherkin
Dado una notificación del OWNER
Cuando el VIEWER intenta marcarla como leída
Entonces responde RESOURCE_NOT_FOUND y sigue no leída
```

## Notas

