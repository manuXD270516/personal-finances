---
id: TC-TRANSACTIONS-SPLIT-001
title: "Los montos de la división (split) deben sumar exactamente el total de la transacción"
spec: transactions/splits
related_specs: ["ledger/journal-posting"]
requirement: "Transacciones divididas"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-002]
nfr: []
invariants: [INV-001, INV-004]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["splits"]
error_code: "SPLIT_SUM_MISMATCH"
preconditions:
  - "Bank A (BOB) con saldo 1000.00"
  - "Categorías Groceries, Household, Personal care"
input:
  total: "150.00 BOB"
  valid_splits:
    Groceries: "100.00"
    Household: "35.50"
    "Personal care": "14.50"
  invalid_splits:
    Groceries: "100.00"
    Household: "35.50"
    "Personal care": "14.49"
steps:
  - "Registrar el gasto con divisiones válidas"
  - "Registrar otro gasto con divisiones inválidas"
expected_result:
  - "Válido: asiento con Bank A -150.00 y tres postings EXPENSE:BOB +100.00, +35.50, +14.50, cada uno con referencia a su split_id"
  - "Inválido (suma 149.99): se rechaza con SPLIT_SUM_MISMATCH y no se persiste nada"
  - "Saldo de Bank A = 850.00 BOB"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-SPLIT-001 — Los montos de la división (split) deben sumar exactamente el total de la transacción

## Intención

Las divisiones llevan la clasificación fuera del ledger; sus postings nominales deben conciliar exactamente con la transacción.

## Escenario

```gherkin
Dado un gasto de 150.00 BOB
Cuando se divide en 100.00 Groceries, 35.50 Household y 14.50 Personal care
Entonces la transacción se registra con tres postings de gasto que referencian cada división
Cuando las divisiones suman 149.99 BOB
Entonces se rechaza con el código "SPLIT_SUM_MISMATCH"
```
