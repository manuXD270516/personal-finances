---
id: TC-COMMITMENTS-RECUR-018
title: 'Una ocurrencia pasa a próxima según la anticipación y a atrasada tras su vencimiento, una sola vez'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Ocurrencias próximas y atrasadas'
scenario: 'Ocurrencia próxima con anticipación'
requirement_status: provisional
fr: ['FR-COMMITMENTS-007']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'status']
error_code: null
preconditions:
  - 'Internet vencimiento 2026-10-20, leadDays 3'
input:
  days: '2026-10-16, 2026-10-17, 2026-10-20, 2026-10-21'
steps:
  - 'Evaluar OccurrenceClock en cada día dos veces'
expected_result:
  - '2026-10-16: SCHEDULED'
  - '2026-10-17: DUE (un solo RecurringOccurrenceDue.v1)'
  - '2026-10-20: DUE'
  - '2026-10-21: OVERDUE (un solo RecurringOccurrenceChanged.v1 OVERDUE)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-018 — Una ocurrencia pasa a próxima según la anticipación y a atrasada tras su vencimiento, una sola vez

## Intención

Las transiciones automáticas son exactamente una vez.

## Escenario

```gherkin
Dado el "Internet" del 2026-10-20 con anticipación de 3 días
Cuando hoy es 2026-10-17
Entonces la ocurrencia pasa a próxima
```

## Notas

- Cubre el scenario "Ocurrencia atrasada".
