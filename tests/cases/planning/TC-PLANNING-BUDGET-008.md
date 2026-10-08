---
id: TC-PLANNING-BUDGET-008
title: 'Un plan no admite objetivos solapados entre categoría, subcategoría y grupo'
spec: planning/budgets
related_specs: ['classification/categories']
requirement: 'Sin solapamiento de objetivos en un plan'
scenario: 'Subcategoría de una categoría presupuestada'
requirement_status: confirmed
fr: ['FR-PLANNING-015', 'FR-PLANNING-016', 'FR-PLANNING-024']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - packages/contexts/planning/src/domain/budget.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'overlap']
error_code: BUDGET_TARGET_OVERLAP
preconditions:
  - 'Categorías: grupo "Alimentación" (gasto) con "Supermercado" (subcategoría "Carnes") y "Restaurantes"; grupo "Vivienda" con "Alquiler" y "Servicios básicos" (subcategoría "Luz"); ingreso "Salario"'
input:
  planA: 'Supermercado + Carnes'
  planB: 'grupo Alimentación + Restaurantes'
steps:
  - 'Agregar "Carnes" a un plan con "Supermercado"'
  - 'Agregar "Restaurantes" a un plan con el grupo "Alimentación"'
expected_result:
  - 'Ambos intentos se rechazan con BUDGET_TARGET_OVERLAP'
  - 'Ningún gasto cuenta en dos líneas del mismo plan'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-008 — Un plan no admite objetivos solapados entre categoría, subcategoría y grupo

## Intención

Evita el doble conteo en el disponible para gastar (design.md decisión 2) sin reglas de prorrateo.

## Escenario

```gherkin
Dado un plan con "Supermercado"
Cuando se agrega su subcategoría "Carnes"
Entonces se rechaza con BUDGET_TARGET_OVERLAP
Dado un plan con el grupo "Alimentación"
Cuando se agrega "Restaurantes"
Entonces se rechaza con BUDGET_TARGET_OVERLAP
```

## Notas

- Cubre también el scenario "Categoría de un grupo presupuestado".
