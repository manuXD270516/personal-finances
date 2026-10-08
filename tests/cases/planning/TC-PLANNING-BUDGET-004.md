---
id: TC-PLANNING-BUDGET-004
title: 'Las líneas de ingreso esperado comparan real y esperado y solo admiten tipo fijo'
spec: planning/budgets
related_specs: []
requirement: 'Ingresos esperados en el plan'
scenario: 'Salario esperado y recibido parcialmente'
requirement_status: confirmed
fr: ['FR-PLANNING-008']
nfr: []
invariants: ['INV-034']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/web/src/ui/planning/budgets.test.tsx
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/contexts/planning/src/domain/budget.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'income']
error_code: BUDGET_INVALID_LINE_KIND
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - '"Salario" esperado 8000.00 BOB en el plan de "2026-11"'
input:
  income: '6500.00 BOB Salario 2026-11-05'
  invalidLine: 'Salario MAXIMUM 8000.00 BOB'
steps:
  - 'Postear el ingreso de 6500.00 BOB'
  - 'Consultar el plan'
  - 'Intentar agregar "Salario" con tipo máximo en otro plan'
expected_result:
  - 'La línea muestra esperado 8000.00 BOB, real 6500.00 BOB y diferencia −1500.00 BOB'
  - 'La línea de ingreso con tipo máximo se rechaza con BUDGET_INVALID_LINE_KIND'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-004 — Las líneas de ingreso esperado comparan real y esperado y solo admiten tipo fijo

## Intención

FR-PLANNING-008 incluye ingresos esperados en el plan; base del modo base cero y de los presupuestos por porcentaje de ingresos.

## Escenario

```gherkin
Dado "Salario" esperado 8000.00 BOB en "2026-11"
Cuando se posteó un ingreso de 6500.00 BOB en "Salario"
Entonces la línea muestra real 6500.00 BOB y diferencia −1500.00 BOB
Cuando se intenta agregar "Salario" con tipo máximo
Entonces se rechaza con BUDGET_INVALID_LINE_KIND
```

## Notas

- Cubre también el scenario "Línea de ingreso con tipo máximo rechazada".
