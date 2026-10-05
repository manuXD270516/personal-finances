---
id: TC-NOTIFICATIONS-DEDUP-001
title: 'Un evento reentregado o procesado en paralelo crea una sola notificación'
spec: notifications/alerts
related_specs: ['planning/budgets', 'platform/event-delivery']
requirement: 'Una sola notificación por hecho de origen'
scenario: 'Evento reentregado'
requirement_status: provisional
fr: ['FR-NOTIFY-005']
nfr: ['NFR-REL-007']
invariants: ['INV-028']
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['notifications', 'idempotency', 'concurrency']
error_code: null
preconditions:
  - 'PostgreSQL real (Testcontainers)'
  - 'OWNER con locale es-BO, email verificado y preferencias por defecto'
input:
  event: 'Evento planning.BudgetThresholdReached.v1: "Restaurantes", periodo "2026-11", threshold "90", alsoCrossed ["50","75"], reference 600.00 BOB, actual 550.00 BOB'
  deliveries: '2 entregas + 2 workers concurrentes'
steps:
  - 'Entregar el mismo evento dos veces a dos workers a la vez'
expected_result:
  - 'El OWNER tiene una sola notificación'
  - 'Una sola entrega por email'
  - 'platform.inbox registra el duplicado'
created: 2026-10-05
updated: 2026-10-05
---

# TC-NOTIFICATIONS-DEDUP-001 — Un evento reentregado o procesado en paralelo crea una sola notificación

## Intención

FR-NOTIFY-005 y exit criteria de Phase 2: exactamente una vez.

## Escenario

```gherkin
Dado el hecho de umbral 90 % de "Restaurantes"
Cuando se entrega dos veces
Entonces el OWNER tiene una sola notificación
```

## Notas

