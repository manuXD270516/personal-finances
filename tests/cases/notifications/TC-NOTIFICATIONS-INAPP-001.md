---
id: TC-NOTIFICATIONS-INAPP-001
title: 'Un umbral alcanzado crea una notificación no leída para cada miembro activo'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Notificación in-app por umbral de presupuesto alcanzado'
scenario: 'Dos miembros notificados'
requirement_status: provisional
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-001']
nfr: ['NFR-PERF-008']
invariants: ['INV-025']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['notifications', 'in-app', 'budgets']
error_code: null
preconditions:
  - 'Workspace "W1 Personal Demo" con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
  - 'VIEWER activo con preferencias por defecto'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
steps:
  - 'Procesar el evento en el consumidor notifications.budget-threshold'
  - 'Listar las notificaciones de cada miembro'
expected_result:
  - 'OWNER y VIEWER tienen una notificación UNREAD de tipo BUDGET_THRESHOLD'
  - 'El contenido indica "Restaurantes", "2026-11", 90 % (también 50 y 75 %), 550.00 de 600.00 BOB'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-INAPP-001 — Un umbral alcanzado crea una notificación no leída para cada miembro activo

## Intención

FR-NOTIFY-004: el umbral de presupuesto es el tipo principal de Phase 2; todos los miembros pueden ver presupuestos.

## Escenario

```gherkin
Dado un OWNER y un VIEWER activos
Cuando se publica el hecho de umbral 90 % de "Restaurantes" en "2026-11"
Entonces cada uno tiene una notificación no leída con 550.00 de 600.00 BOB
```

## Notas

- Lag evento→notificación medido contra NFR-PERF-008 (p95 ≤ 5 s).
