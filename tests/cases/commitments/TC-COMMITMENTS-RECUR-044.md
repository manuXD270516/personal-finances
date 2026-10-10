---
id: TC-COMMITMENTS-RECUR-044
title: 'El mismo hecho de ocurrencia próxima entregado dos veces genera una sola notificación'
spec: notifications/alerts
related_specs: [commitments/recurrence-engine]
requirement: 'Aviso de pago próximo u ocurrencia por aprobar'
scenario: 'Hecho entregado dos veces'
requirement_status: provisional
fr: ['FR-NOTIFY-005']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['notifications', 'idempotency']
error_code: null
preconditions:
  - 'Consumidor notifications.occurrence-due'
input:
  eventIds: 'dos eventId distintos, mismo occurrenceId'
steps:
  - 'Entregar ambos eventos'
expected_result:
  - 'Una notificación por destinatario (dedupe occurrence-due:<occurrenceId>)'
  - 'Un solo email por destinatario'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-044 — El mismo hecho de ocurrencia próxima entregado dos veces genera una sola notificación

## Intención

FR-NOTIFY-005: idempotencia en dos capas.

## Escenario

```gherkin
Dado el hecho de la ocurrencia del 2026-11-05 entregado dos veces
Cuando el consumidor los procesa
Entonces cada destinatario tiene una sola notificación
```

## Notas

