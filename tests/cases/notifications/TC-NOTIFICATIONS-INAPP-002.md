---
id: TC-NOTIFICATIONS-INAPP-002
title: 'Un miembro que desactivó el tipo in-app no recibe la notificación'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Notificación in-app por umbral de presupuesto alcanzado'
scenario: 'Miembro que desactivó el tipo in-app'
requirement_status: confirmed
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-003']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/notifications.api.test.ts
  - packages/contexts/notifications/src/application/notify-from-event.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['notifications', 'preferences']
error_code: null
preconditions:
  - 'Workspace "W1 Personal Demo" con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'VIEWER con BUDGET_THRESHOLD/IN_APP desactivado'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento'
  - 'Listar las notificaciones de cada miembro'
expected_result:
  - 'Solo el OWNER tiene la notificación'
  - 'El VIEWER no tiene notificación ni entrega por email'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-INAPP-002 — Un miembro que desactivó el tipo in-app no recibe la notificación

## Intención

Las preferencias filtran destinatarios por canal.

## Escenario

```gherkin
Dado un VIEWER con el in-app de umbrales desactivado
Cuando se publica el hecho de umbral 90 %
Entonces solo el OWNER recibe la notificación
```

## Notas

