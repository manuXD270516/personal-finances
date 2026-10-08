---
id: TC-PLANNING-BUDGET-002
title: 'No se crea un plan para un periodo cerrado'
spec: planning/budgets
related_specs: ['planning/financial-periods']
requirement: 'Un plan mensual por periodo financiero'
scenario: 'Periodo cerrado no admite plan nuevo'
requirement_status: confirmed
fr: ['FR-PLANNING-008', 'FR-PLANNING-005']
nfr: []
invariants: ['INV-015']
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'period-closed']
error_code: PERIOD_CLOSED
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Periodo "2026-09" cerrado y sin plan'
input:
  periodId: '2026-09'
  source: 'EMPTY'
steps:
  - 'Intentar crear el plan del periodo "2026-09"'
expected_result:
  - 'Responde 409 PERIOD_CLOSED'
  - 'No existe plan para "2026-09"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-002 — No se crea un plan para un periodo cerrado

## Intención

Un periodo cerrado no cambia en silencio (INV-015): crear su plan después del cierre alteraría el presupuesto vs real congelado en el snapshot.

## Escenario

```gherkin
Dado el periodo "2026-09" cerrado
Cuando se intenta crear su plan
Entonces se rechaza con PERIOD_CLOSED
```

## Notas

- Depende de los estados de periodo de add-financial-periods (sibling pf-p2a).
