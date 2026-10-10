---
id: TC-COMMITMENTS-RECUR-015
title: 'Dos generaciones concurrentes de la misma ventana producen una ocurrencia y un hecho por fecha'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Generación idempotente de ocurrencias'
scenario: 'Dos workers en paralelo'
requirement_status: provisional
fr: ['FR-COMMITMENTS-006']
nfr: []
invariants: ['INV-013']
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 3
tags: ['recurrence', 'concurrency']
error_code: null
preconditions:
  - 'Postgres real con la migración aplicada'
  - 'Definición "Internet" mensual sin ocurrencias'
input:
  window: '2026-10-09..2027-01-07'
steps:
  - 'Lanzar dos GenerateOccurrences en paralelo (dos conexiones)'
expected_result:
  - '3 ocurrencias (2026-10-20, 2026-11-20, 2026-12-20)'
  - 'Un solo OccurrencesGenerated.v1 en el outbox que las incluye una vez'
  - 'UNIQUE (definition_id, occurrence_date) nunca violado como error al cliente'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-015 — Dos generaciones concurrentes de la misma ventana producen una ocurrencia y un hecho por fecha

## Intención

INV-013 bajo concurrencia real (BD + FOR UPDATE + ON CONFLICT).

## Escenario

```gherkin
Dado la definición "Internet" sin ocurrencias
Cuando dos workers generan la misma ventana en paralelo
Entonces cada fecha tiene una sola ocurrencia
```

## Notas

