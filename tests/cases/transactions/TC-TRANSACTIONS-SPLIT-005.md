---
id: TC-TRANSACTIONS-SPLIT-005
title: "Recategorizar un split no crea asientos y publica el cambio de categoría"
spec: transactions/splits
related_specs: ["ledger/journal-posting", "classification/categories"]
requirement: "Cambiar la clasificación de un split sin tocar el ledger"
scenario: "Recategorizar un split de 35.50 BOB"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-028, FR-LEDGER-008]
nfr: []
invariants: [INV-033, INV-007]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["splits", "classification", "events"]
error_code: null
preconditions:
  - "Gasto posteado de 150.00 BOB con splits 100.00 Groceries, 35.50 Household, 14.50 Personal care (asiento E1)"
input:
  split: "35.50 BOB Household"
  new_category: "Personal care"
steps: ["Cambiar la categoría del split", "Contar asientos y comparar postings", "Leer el outbox"]
expected_result:
  - "Sin asientos nuevos; postings de E1 idénticos"
  - "Gasto de marzo: Household -35.50 BOB y Personal care +35.50 BOB respecto de antes"
  - "Outbox: transactions.TransactionCategorized.v1 con appliedBy USER y un cambio {splitId, amount 35.50 BOB, previousCategoryId Household, newCategoryId Personal care}"
  - "Auditoría con diff de categoría"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-SPLIT-005 — Recategorizar un split no crea asientos y publica el cambio de categoría

## Intención

Recategorizar nunca toca el ledger (INV-033); Planning/Reporting dependen del evento por split.

## Escenario

```gherkin
Dado un gasto posteado con un split de 35.50 BOB en Household
Cuando el usuario lo cambia a Personal care
Entonces no se crea ningún asiento
  Y se publica un evento de transacción categorizada
```
