---
id: TC-TRANSACTIONS-EXPENSE-001
title: "Un gasto posteado reduce el activo o aumenta la deuda de la tarjeta y se reconoce en su categoría"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Registro de un gasto"
scenario: "Gasto de supermercado desde el banco"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-001, FR-TRANSACTIONS-007]
nfr: []
invariants: [INV-004, INV-021]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["expense", "ledger", "credit-card"]
error_code: null
preconditions:
  - "Bank A (ASSET, BOB) con saldo 1000.00 BOB"
  - "Credit Card (LIABILITY, BOB) con deuda 0.00 BOB"
  - "Categorías \"Groceries\" y \"Household\" activas"
input:
  - account: "Bank A"
    amount: "150.00 BOB"
    category: "Groceries"
    date: "2026-03-10"
  - account: "Credit Card"
    amount: "350.00 BOB"
    category: "Household"
    date: "2026-03-12"
steps:
  - "Registrar ambos gastos como posted"
  - "Leer saldos y asientos"
  - "Consultar gastos de marzo de 2026 por categoría"
expected_result:
  - "Asiento 1: EXPENSE:BOB +150.00 (split Groceries); Bank A -150.00; suma 0.00 BOB"
  - "Asiento 2: EXPENSE:BOB +350.00 (split Household); Credit Card -350.00; suma 0.00 BOB"
  - "Saldo de Bank A = 850.00 BOB; deuda presentada de Credit Card = 350.00 BOB"
  - "Gasto de marzo: Groceries 150.00 BOB, Household 350.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-EXPENSE-001 — Un gasto posteado reduce el activo o aumenta la deuda de la tarjeta y se reconoce en su categoría

## Intención

Patrón de postings del gasto sobre ASSET y LIABILITY (docs/09 §6.2 y §6.8).

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB y "Credit Card" adeuda 0.00 BOB
Cuando el usuario registra un gasto de 150.00 BOB en "Groceries" desde "Bank A"
  Y un gasto de 350.00 BOB en "Household" con "Credit Card"
Entonces "Bank A" tiene 850.00 BOB
  Y "Credit Card" adeuda 350.00 BOB
```
