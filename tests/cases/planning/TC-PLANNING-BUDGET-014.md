---
id: TC-PLANNING-BUDGET-014
title: 'El presupuesto de un grupo suma sus categorías y subcategorías'
spec: planning/budgets
related_specs: ['classification/categories']
requirement: 'Presupuesto por grupo de categorías'
scenario: 'Grupo Vivienda'
requirement_status: confirmed
fr: ['FR-PLANNING-016']
nfr: []
invariants: ['INV-034']
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/contexts/planning/src/domain/budget.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'group']
error_code: null
preconditions:
  - 'Categorías: grupo "Alimentación" (gasto) con "Supermercado" (subcategoría "Carnes") y "Restaurantes"; grupo "Vivienda" con "Alquiler" y "Servicios básicos" (subcategoría "Luz"); ingreso "Salario"'
  - 'Grupo "Vivienda" con máximo 3200.00 BOB en "2026-11"'
input:
  expenses: ['2800.00 BOB Alquiler', '250.00 BOB Servicios básicos', '60.00 BOB Luz']
steps:
  - 'Postear los gastos en noviembre'
  - 'Consultar el plan'
expected_result:
  - 'Gastado del grupo "Vivienda" 3110.00 BOB'
  - 'Restante 90.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-014 — El presupuesto de un grupo suma sus categorías y subcategorías

## Intención

FR-PLANNING-016 (Should): presupuestar por grupo sin detallar cada categoría.

## Escenario

```gherkin
Dado el grupo "Vivienda" con máximo 3200.00 BOB
Cuando hay 2800.00 BOB en "Alquiler", 250.00 BOB en "Servicios básicos" y 60.00 BOB en "Luz"
Entonces el gastado del grupo es 3110.00 BOB con restante 90.00 BOB
```

## Notas

