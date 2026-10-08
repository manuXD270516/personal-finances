---
id: TC-PLANNING-BUDGET-010
title: 'Una línea con planificado cero y gasto se marca sin presupuesto y sin porcentaje'
spec: planning/budgets
related_specs: []
requirement: 'Progreso por línea con restante, porcentaje y proyección'
scenario: 'Línea sin presupuesto con gasto'
requirement_status: confirmed
fr: ['FR-PLANNING-024']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'progress', 'edge-case']
error_code: null
preconditions:
  - '"Regalos" con planificado 0.00 BOB en "2026-11"'
input:
  actual: '40.00 BOB'
steps:
  - 'Calcular el progreso'
expected_result:
  - 'Estado "sin presupuesto"'
  - 'Porcentaje sin definir (null), nunca infinito'
  - 'Restante −40.00 BOB'
  - 'No se evalúan umbrales'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-010 — Una línea con planificado cero y gasto se marca sin presupuesto y sin porcentaje

## Intención

docs/14 §4 (budget utilization): con presupuesto 0 y gasto no hay porcentaje válido.

## Escenario

```gherkin
Dado "Regalos" con planificado 0.00 BOB
Cuando el gastado es 40.00 BOB
Entonces la línea queda "sin presupuesto" con porcentaje sin definir y restante −40.00 BOB
```

## Notas

