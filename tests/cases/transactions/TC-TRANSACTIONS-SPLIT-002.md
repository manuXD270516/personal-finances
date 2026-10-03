---
id: TC-TRANSACTIONS-SPLIT-002
title: "Un gasto sin splits recibe un único split en la categoría Uncategorized"
spec: transactions/splits
related_specs: ["classification/categories"]
requirement: "Al menos un split por transacción nominal"
scenario: "Gasto sin categoría"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-026, FR-CLASSIFICATION-003]
nfr: []
invariants: [INV-021]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["splits", "uncategorized"]
error_code: null
preconditions: ["Bank A (BOB)", "Categoría de sistema \"Uncategorized\""]
input:
  kind: "EXPENSE"
  account: "Bank A"
  amount: "75.00 BOB"
  splits: null
steps: ["Registrar el gasto sin splits", "Consultar la transacción y su asiento"]
expected_result:
  - "La transacción tiene exactamente un split de 75.00 BOB en \"Uncategorized\""
  - "El posting EXPENSE:BOB +75.00 referencia ese split"
  - "Una lista de splits vacía explícita se rechaza con VALIDATION_FAILED"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-SPLIT-002 — Un gasto sin splits recibe un único split en la categoría Uncategorized

## Intención

Toda porción nominal debe estar clasificada, aunque sea como pendiente de clasificar (FR-TRANSACTIONS-026).

## Escenario

```gherkin
Dado "Bank A" en BOB
Cuando el usuario registra un gasto de 75.00 BOB sin splits
Entonces la transacción tiene un único split de 75.00 BOB en "Uncategorized"
```
