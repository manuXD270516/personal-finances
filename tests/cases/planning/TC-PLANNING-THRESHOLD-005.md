---
id: TC-PLANNING-THRESHOLD-005
title: 'Reentregas y evaluaciones concurrentes producen un solo cruce y un solo hecho'
spec: planning/budgets
related_specs: ['platform/event-delivery']
requirement: 'Cruce de umbral emitido una sola vez por umbral y periodo'
scenario: 'Evento de transacción reprocesado'
requirement_status: confirmed
fr: ['FR-PLANNING-022']
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
tags: ['budgets', 'thresholds', 'idempotency', 'concurrency']
error_code: null
preconditions:
  - 'PostgreSQL real (Testcontainers)'
  - '"Restaurantes" máximo 600.00 BOB con gastado 280.00 BOB'
input:
  expense: '30.00 BOB'
  deliveries: '2 entregas del mismo evento + 2 workers en paralelo'
steps:
  - 'Postear el gasto'
  - 'Entregar el evento dos veces y ejecutar dos evaluaciones concurrentes del mismo plan'
expected_result:
  - 'Un solo registro de cruce del 50 % (PK por objetivo, umbral y periodo)'
  - 'Un solo planning.BudgetThresholdReached.v1 en el outbox'
  - 'La segunda entrega queda como duplicada en platform.inbox'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-THRESHOLD-005 — Reentregas y evaluaciones concurrentes producen un solo cruce y un solo hecho

## Intención

Exit criteria de Phase 2: alertas de umbral exactamente una vez; INV-028.

## Escenario

```gherkin
Dado "Restaurantes" con gastado 280.00 BOB
Cuando el evento del gasto de 30.00 BOB se entrega dos veces y dos workers evalúan a la vez
Entonces existe un solo cruce del 50 % y un solo hecho emitido
```

## Notas

