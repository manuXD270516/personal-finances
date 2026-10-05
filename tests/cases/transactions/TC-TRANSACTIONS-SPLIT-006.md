---
id: TC-TRANSACTIONS-SPLIT-006
title: "Un split rechaza categorías archivadas o de tipo incompatible"
spec: transactions/splits
related_specs: ["classification/categories"]
requirement: "Categorías válidas para un split"
scenario: "Categoría archivada"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-026, FR-CLASSIFICATION-002]
nfr: []
invariants: [INV-019]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/transactions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["splits", "classification", "validation"]
error_code: "CATEGORY_ARCHIVED"
preconditions:
  - "Categoría archivada \"Old Gym\" (expense)"
  - "Categoría de ingreso \"Salary\""
  - "Bank A (BOB)"
input:
  - kind: "EXPENSE"
    amount: "40.00 BOB"
    category: "Old Gym"
  - kind: "EXPENSE"
    amount: "40.00 BOB"
    category: "Salary"
steps: ["Registrar cada gasto"]
expected_result:
  - "Primero: 409 CATEGORY_ARCHIVED"
  - "Segundo: 422 CATEGORY_KIND_MISMATCH"
  - "Nada persistido"
created: 2026-10-02
updated: 2026-10-05
---

# TC-TRANSACTIONS-SPLIT-006 — Un split rechaza categorías archivadas o de tipo incompatible

## Intención

INV-019: categorías archivadas no se asignan a splits nuevos; la coherencia de tipo protege los reportes.

## Escenario

```gherkin
Dado que "Old Gym" está archivada
Cuando el usuario registra un gasto de 40.00 BOB en "Old Gym"
Entonces se rechaza con el código "CATEGORY_ARCHIVED"
```
