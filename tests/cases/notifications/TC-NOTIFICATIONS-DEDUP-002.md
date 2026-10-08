---
id: TC-NOTIFICATIONS-DEDUP-002
title: 'El mismo hecho con otro identificador de evento no duplica la notificación'
spec: notifications/alerts
related_specs: ['planning/budgets']
requirement: 'Una sola notificación por hecho de origen'
scenario: 'Mismo hecho con otro identificador de evento'
requirement_status: confirmed
fr: ['FR-NOTIFY-005']
nfr: []
invariants: ['INV-028']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['notifications', 'idempotency', 'dedupe-key']
error_code: null
preconditions:
  - 'Estado final de TC-NOTIFICATIONS-DEDUP-001'
input:
  event: 'Mismo objetivo, periodo y umbral 90 % con otro eventId'
steps:
  - 'Procesar el segundo evento'
expected_result:
  - 'No se crea otra notificación (dedupe_key budget-threshold:<periodo>:CATEGORY:<Restaurantes>:90)'
  - 'No se crea otra entrega por email'
created: 2026-10-05
updated: 2026-10-08
---

# TC-NOTIFICATIONS-DEDUP-002 — El mismo hecho con otro identificador de evento no duplica la notificación

## Intención

La clave de negocio cubre republicaciones con otro eventId que el inbox no detecta.

## Escenario

```gherkin
Dado la notificación del umbral 90 % ya creada
Cuando llega otro evento con distinto id para el mismo hecho
Entonces no se crea una segunda notificación
```

## Notas

