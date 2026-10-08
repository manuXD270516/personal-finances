---
id: TC-PLANNING-BUDGET-012
title: 'Las líneas del plan de un periodo cerrado no se modifican'
spec: planning/budgets
related_specs: ['planning/financial-periods']
requirement: 'Plan de un periodo cerrado inmutable'
scenario: 'Editar una línea de octubre cerrado'
requirement_status: confirmed
fr: ['FR-PLANNING-005', 'FR-PLANNING-022']
nfr: []
invariants: ['INV-015']
priority: critical
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
  - 'Periodo "2026-10" cerrado con "Restaurantes" máximo 600.00 BOB en su plan'
input:
  change: 'Restaurantes MAXIMUM 700.00 BOB'
steps:
  - 'Intentar cambiar el máximo'
  - 'Intentar agregar y quitar una línea del mismo plan'
expected_result:
  - 'Todas las operaciones responden 409 PERIOD_CLOSED'
  - 'La línea conserva 600.00 BOB'
  - 'No se registran cruces nuevos para "2026-10"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-012 — Las líneas del plan de un periodo cerrado no se modifican

## Intención

INV-015: un periodo cerrado no cambia en silencio; el snapshot de cierre congela el presupuesto vs real.

## Escenario

```gherkin
Dado "2026-10" cerrado con "Restaurantes" máximo 600.00 BOB
Cuando se intenta cambiar el máximo a 700.00 BOB
Entonces se rechaza con PERIOD_CLOSED y la línea conserva 600.00 BOB
```

## Notas

