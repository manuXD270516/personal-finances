---
id: TC-PLANNING-BUDGET-007
title: 'Las líneas con montos, moneda, escala u objetivo inválidos se rechazan sin cambios'
spec: planning/budgets
related_specs: ['classification/categories']
requirement: 'Montos y objetivos válidos en las líneas del plan'
scenario: null
requirement_status: provisional
fr: ['FR-PLANNING-015', 'FR-PLANNING-018']
nfr: []
invariants: ['INV-001', 'INV-002', 'INV-003']
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'validation', 'money']
error_code: BUDGET_INVALID_AMOUNTS
preconditions:
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - 'El plan ya tiene una línea "Supermercado"'
  - 'Categoría "Gimnasio" archivada'
input:
  negative: 'Restaurantes MAXIMUM -100.00 BOB'
  currency: 'Restaurantes MAXIMUM 100.00 USD'
  scale: 'Restaurantes MAXIMUM 100.005 BOB'
  archived: 'Gimnasio MAXIMUM 200.00 BOB'
  duplicate: 'Supermercado MAXIMUM 900.00 BOB'
  range: 'Restaurantes RANGE min 700.00 max 600.00 BOB'
steps:
  - 'Enviar cada línea inválida por separado'
expected_result:
  - 'Negativo y rango invertido ⇒ 422 BUDGET_INVALID_AMOUNTS'
  - 'Moneda USD ⇒ 422 CURRENCY_MISMATCH'
  - '100.005 BOB ⇒ 422 AMOUNT_SCALE_EXCEEDED'
  - 'Gimnasio ⇒ 409 CATEGORY_ARCHIVED'
  - 'Supermercado repetido ⇒ 409 BUDGET_LINE_DUPLICATE_TARGET'
  - 'El plan no cambia y no hay registros de auditoría'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-BUDGET-007 — Las líneas con montos, moneda, escala u objetivo inválidos se rechazan sin cambios

## Intención

Los montos planificados son dinero: nunca negativos, siempre en la moneda y escala del plan (INV-001..003); los objetivos deben ser asignables.

## Escenario

```gherkin
Dado el plan de "2026-11" con "Supermercado"
Cuando se envían líneas con −100.00 BOB, 100.00 USD, 100.005 BOB, "Gimnasio" archivada o "Supermercado" repetido
Entonces cada una se rechaza con su código y el plan no cambia
```

## Notas

- Montos como string decimal en la API (ADR-0006).
