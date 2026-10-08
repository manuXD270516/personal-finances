---
id: TC-PLANNING-BUDGET-005
title: 'Un presupuesto fijo informa objetivo cumplido o por debajo con su restante'
spec: planning/budgets
related_specs: []
requirement: 'Presupuesto de tipo fijo'
scenario: 'Alquiler pagado exacto'
requirement_status: confirmed
fr: ['FR-PLANNING-018']
nfr: []
invariants: ['INV-020']
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'fixed']
error_code: null
preconditions:
  - '"Alquiler" con fijo 2800.00 BOB en "2026-11"'
input:
  actualA: '2800.00 BOB'
  actualB: '2700.00 BOB'
steps:
  - 'Calcular el progreso con gastado 2800.00 BOB'
  - 'Calcular el progreso con gastado 2700.00 BOB'
expected_result:
  - 'Con 2800.00 BOB: en el objetivo, restante 0.00 BOB, 100.0 %'
  - 'Con 2700.00 BOB: por debajo del objetivo, restante 100.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-005 — Un presupuesto fijo informa objetivo cumplido o por debajo con su restante

## Intención

FR-PLANNING-018 (fixed): el monto planificado es exacto; el estado distingue cumplido de pendiente.

## Escenario

```gherkin
Dado "Alquiler" con fijo 2800.00 BOB
Cuando el gastado es 2800.00 BOB
Entonces la línea está en el objetivo con restante 0.00 BOB y 100.0 %
Cuando el gastado es 2700.00 BOB
Entonces la línea está por debajo con restante 100.00 BOB
```

## Notas

- Test de dominio puro de BudgetProgressCalculator; cubre también "Alquiler pagado de menos".
