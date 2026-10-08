---
id: TC-NOTIFICATIONS-INAPP-007
title: 'El hecho de cierre pendiente notifica solo a OWNER y EDITOR'
spec: notifications/alerts
related_specs: ['planning/month-closing']
requirement: 'Aviso de cierre de mes pendiente'
scenario: 'Octubre sin cerrar'
requirement_status: confirmed
fr: ['FR-NOTIFY-004']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ['notifications', 'month-closing']
error_code: null
preconditions:
  - 'Workspace "W1 Personal Demo" con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - 'Miembros OWNER, EDITOR y VIEWER con preferencias por defecto'
  - 'Periodo "2026-10" terminado y sin cerrar'
input:
  event: 'planning.MonthClosePending.v1 periodo 2026-10 (publicado por add-month-closing)'
steps:
  - 'Procesar el evento dos veces'
expected_result:
  - 'OWNER y EDITOR tienen una notificación MONTH_CLOSE_PENDING de "2026-10" con enlace al cierre'
  - 'El VIEWER no la recibe'
  - 'La segunda entrega no duplica'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-INAPP-007 — El hecho de cierre pendiente notifica solo a OWNER y EDITOR

## Intención

FR-NOTIFY-004: "cierre de mes pendiente" es tipo de Phase 2.

## Escenario

```gherkin
Dado "2026-10" terminado sin cerrar
Cuando Planning publica el hecho de cierre pendiente
Entonces OWNER y EDITOR reciben una notificación y el VIEWER no
```

## Notas

- draft: el evento lo define add-month-closing (sibling pf-p2a); pregunta abierta 4 de add-alerts.
