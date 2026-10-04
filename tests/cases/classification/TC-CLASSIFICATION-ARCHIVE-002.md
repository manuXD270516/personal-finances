---
id: TC-CLASSIFICATION-ARCHIVE-002
title: Una categoría archivada no puede asignarse a transacciones nuevas ni aparece en el selector
spec: classification/categories
related_specs: [transactions/transaction-recording]
requirement: Una categoría archivada no es asignable
scenario: Asignación a una categoría archivada
requirement_status: confirmed
fr: [FR-CLASSIFICATION-002]
nfr: []
invariants: [INV-019]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/classification.service.test.ts
  - apps/web/src/ui/classification/classification.test.tsx
  - tests/e2e/specs/classification.spec.ts
status: automated
regression_suite: true
phase: 1
tags: [archive, cross-context]
error_code: CATEGORY_ARCHIVED
preconditions:
- Categoría "Old Gym" archivada
input:
  record:
    amount: '150.00'
    currency: BOB
    category: Old Gym
    date: '2026-03-01'
  list: GET /api/v1/workspaces/{W1}/categories
steps:
- Registrar el gasto con "Old Gym"
- Listar categorías sin includeArchived
- Listar con includeArchived=true
expected_result:
- El gasto se rechaza con CATEGORY_ARCHIVED
- El listado por defecto no contiene "Old Gym"
- El listado con includeArchived=true contiene "Old Gym" con archivedAt
created: 2026-10-02
updated: 2026-10-04
---

# TC-CLASSIFICATION-ARCHIVE-002 — Una categoría archivada no puede asignarse a transacciones nuevas ni aparece en el selector

## Intención

FR-CLASSIFICATION-002: las archivadas no aparecen en selectores ni se asignan a porciones nuevas.

## Escenario

```gherkin
Dada la categoría archivada "Old Gym"
Cuando se registra un gasto de 150.00 BOB con fecha 2026-03-01 en ella
Entonces se rechaza con "CATEGORY_ARCHIVED"
  Y no aparece en el listado por defecto
```
