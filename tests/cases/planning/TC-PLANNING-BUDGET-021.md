---
id: TC-PLANNING-BUDGET-021
title: 'Un presupuesto por tag suma gastos de varias categorías y no entra al disponible'
spec: planning/budgets
related_specs: ['classification/tags']
requirement: 'Presupuesto por tag'
scenario: 'Tag de viaje'
requirement_status: confirmed
fr: ['FR-PLANNING-017']
nfr: []
invariants: []
priority: low
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'tag']
error_code: null
preconditions:
  - 'Tag "Viaje Santa Cruz" con máximo 2000.00 BOB en "2026-11"'
input:
  expenses: ['1200.00 BOB Transporte (tag)', '300.00 BOB Restaurantes (tag)']
steps:
  - 'Postear los gastos etiquetados'
  - 'Consultar el plan'
expected_result:
  - 'Gastado del tag 1500.00 BOB'
  - 'El disponible para gastar no incluye la línea del tag'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-021 — Un presupuesto por tag suma gastos de varias categorías y no entra al disponible

## Intención

FR-PLANNING-017 (Could): presupuestos transversales a categorías.

## Escenario

```gherkin
Dado el tag "Viaje Santa Cruz" con máximo 2000.00 BOB
Cuando hay gastos con ese tag de 1200.00 BOB en "Transporte" y 300.00 BOB en "Restaurantes"
Entonces el gastado del tag es 1500.00 BOB
  Y el disponible para gastar no incluye esa línea
```

## Notas

- Requiere `tagIds` por fila en NominalFlowQuery (design.md § Contratos).
