---
id: TC-PLANNING-BUDGET-001
title: 'Se crea un único plan vacío por periodo y un segundo plan se rechaza'
spec: planning/budgets
related_specs: ['planning/financial-periods']
requirement: 'Un plan mensual por periodo financiero'
scenario: 'Segundo plan para el mismo periodo rechazado'
requirement_status: confirmed
fr: ['FR-PLANNING-008', 'FR-PLANNING-015']
nfr: []
invariants: ['INV-025']
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/contexts/planning/src/domain/budget.test.ts
  - packages/contexts/planning/test/integration/pg-budgets.int.test.ts
  - tests/e2e/specs/budgets.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'plan', 'idempotency']
error_code: BUDGET_ALREADY_EXISTS
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Periodo "2026-11" en estado borrador sin plan'
  - 'Usuario con rol EDITOR'
input:
  periodId: '2026-11'
  source: 'EMPTY'
steps:
  - 'Crear el plan vacío del periodo "2026-11"'
  - 'Intentar crear otro plan para "2026-11" con otra Idempotency-Key'
expected_result:
  - 'El primer POST responde 201 con plan en BOB, sin líneas y origen EMPTY'
  - 'El segundo POST responde 409 BUDGET_ALREADY_EXISTS'
  - 'Sigue existiendo un único plan para "2026-11", sin cambios'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-001 — Se crea un único plan vacío por periodo y un segundo plan se rechaza

## Intención

FR-PLANNING-008: cada periodo tiene a lo sumo un plan mensual en moneda base (design.md decisión 1); un segundo plan duplicaría el presupuesto y el disponible para gastar.

## Escenario

```gherkin
Dado el periodo "2026-11" sin plan
Cuando el EDITOR crea un plan vacío para "2026-11"
Entonces el plan queda en BOB sin líneas
Cuando intenta crear otro plan para "2026-11"
Entonces se rechaza con BUDGET_ALREADY_EXISTS
  Y el plan existente no cambia
```

## Notas

- Cubre también el scenario "Plan vacío creado para noviembre".
- La unicidad la refuerza UNIQUE (workspace_id, period_id) en la BD.
