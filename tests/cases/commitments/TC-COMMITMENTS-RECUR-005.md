---
id: TC-COMMITMENTS-RECUR-005
title: 'La cadencia trimestral con intervalo 2 produce una fecha cada seis meses'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cadencias predefinidas con intervalo'
scenario: 'Trimestral con intervalo 2'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-002']
nfr: []
invariants: []
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/shared-kernel/src/recurrence/recurrence.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'cadence']
error_code: null
preconditions:
  - 'Regla QUARTERLY interval 2 dtstart 2026-01-10'
input:
  window: '2026-01-01..2027-03-31'
steps:
  - 'expand(regla, ventana)'
expected_result:
  - '[2026-01-10, 2026-07-10, 2027-01-10]'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-005 — La cadencia trimestral con intervalo 2 produce una fecha cada seis meses

## Intención

FR-COMMITMENTS-002: el intervalo N multiplica el periodo de cada cadencia predefinida.

## Escenario

```gherkin
Dado una cadencia trimestral con intervalo 2 desde 2026-01-10
Cuando se expande hasta 2027-03-31
Entonces las fechas son 2026-01-10, 2026-07-10 y 2027-01-10
```

## Notas

- Tabla de casos para las 9 cadencias con intervalo 1 y 3 en el mismo test.
