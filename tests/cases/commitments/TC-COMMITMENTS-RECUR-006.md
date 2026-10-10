---
id: TC-COMMITMENTS-RECUR-006
title: 'La cadencia semimensual exige dos días y produce el 15 y el último de cada mes'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cadencias predefinidas con intervalo'
scenario: 'Semimensual los días 15 y último'
requirement_status: provisional
fr: ['FR-COMMITMENTS-002']
nfr: []
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'cadence']
error_code: RECURRING_INVALID_SCHEDULE
preconditions:
  - 'Regla SEMIMONTHLY monthDays [15, -1] dtstart 2026-10-01'
input:
  window: '2026-10-01..2026-11-30'
  invalid: 'SEMIMONTHLY monthDays [15]'
steps:
  - 'expand(regla, ventana)'
  - 'Construir la regla inválida'
expected_result:
  - '[2026-10-15, 2026-10-31, 2026-11-15, 2026-11-30]'
  - 'La regla con un solo día se rechaza con RECURRING_INVALID_SCHEDULE'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-006 — La cadencia semimensual exige dos días y produce el 15 y el último de cada mes

## Intención

El semimensual es típico de sueldos en Bolivia (15 y fin de mes).

## Escenario

```gherkin
Dado una cadencia semimensual con los días 15 y último desde 2026-10-01
Cuando se expande octubre y noviembre
Entonces las fechas son 2026-10-15, 2026-10-31, 2026-11-15 y 2026-11-30
```

## Notas

- Cubre el scenario "Semimensual con un solo día".
