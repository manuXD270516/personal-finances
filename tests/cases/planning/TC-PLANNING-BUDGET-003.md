---
id: TC-PLANNING-BUDGET-003
title: 'El presupuesto de una categoría incluye sus subcategorías y solo el gasto del periodo'
spec: planning/budgets
related_specs: ['classification/categories', 'transactions/transaction-recording']
requirement: 'Presupuesto por categoría con sus subcategorías'
scenario: 'Gasto de la subcategoría incluido'
requirement_status: confirmed
fr: ['FR-PLANNING-015', 'FR-PLANNING-024']
nfr: []
invariants: ['INV-034']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - packages/contexts/planning/src/application/budgets.service.test.ts
status: automated
regression_suite: true
phase: 2
tags: ['budgets', 'actual', 'hierarchy']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - 'Categorías: grupo "Alimentación" (gasto) con "Supermercado" (subcategoría "Carnes") y "Restaurantes"; grupo "Vivienda" con "Alquiler" y "Servicios básicos" (subcategoría "Luz"); ingreso "Salario"'
  - '"Supermercado" con máximo 1500.00 BOB en el plan de "2026-11"'
input:
  expenses: ['400.00 BOB Supermercado 2026-11-03', '150.00 BOB Carnes 2026-11-04', '200.00 BOB Restaurantes 2026-11-05', '90.00 BOB Supermercado 2026-10-31']
steps:
  - 'Postear los cuatro gastos'
  - 'Consultar el plan de "2026-11"'
expected_result:
  - 'El gastado de "Supermercado" es 550.00 BOB (400.00 + 150.00)'
  - 'El gasto de "Restaurantes" y el del 2026-10-31 no cuentan'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-003 — El presupuesto de una categoría incluye sus subcategorías y solo el gasto del periodo

## Intención

FR-PLANNING-015: el presupuesto de una categoría abarca sus subcategorías; sin esto, los gastos clasificados con más detalle escaparían al control.

## Escenario

```gherkin
Dado "Supermercado" con máximo 1500.00 BOB en "2026-11"
  Y gastos de 400.00 BOB en "Supermercado", 150.00 BOB en "Carnes", 200.00 BOB en "Restaurantes" y 90.00 BOB en "Supermercado" el 2026-10-31
Cuando consulto el plan de "2026-11"
Entonces el gastado de "Supermercado" es 550.00 BOB
```

## Notas

- Cubre también el scenario "Gasto fuera del periodo excluido".
