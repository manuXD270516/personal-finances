---
id: TC-NOTIFICATIONS-EMAIL-005
title: 'Repetir el despacho de un email ya aceptado no envía un segundo email'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Email entregado una sola vez'
scenario: 'Reintento tras envío aceptado'
requirement_status: provisional
fr: ['FR-NOTIFY-002', 'FR-NOTIFY-005']
nfr: ['NFR-REL-007']
invariants: ['INV-028']
priority: critical
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['notifications', 'email', 'exactly-once']
error_code: null
preconditions:
  - 'Estado final de TC-NOTIFICATIONS-EMAIL-004 (entrega SENT)'
input:
  rerun: 'ejecutar el job de despacho otra vez y en dos workers a la vez'
steps:
  - 'Volver a ejecutar notifications.email-dispatch para la misma entrega'
  - 'Consultar Mailpit'
expected_result:
  - 'Mailpit contiene un solo email para esa notificación'
  - 'La entrega sigue SENT con attempts = 1'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-EMAIL-005 — Repetir el despacho de un email ya aceptado no envía un segundo email

## Intención

Exit criteria de Phase 2: entrega exactamente una vez (claim con lease, design.md decisión 7).

## Escenario

```gherkin
Dado el email del umbral 90 % ya aceptado
Cuando el job de envío se ejecuta otra vez
Entonces Mailpit contiene un solo email
```

## Notas

- El residuo de la ventana entre aceptación y SENT se documenta en design.md (Riesgos).
