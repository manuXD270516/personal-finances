---
id: TC-TRANSACTIONS-REFUND-001
title: "El reembolso reduce el gasto de la categoría original y no es un ingreso"
spec: transactions/transaction-recording
related_specs: ["reporting/dashboard"]
requirement: "Reembolsos"
scenario: "Devolución parcial de una compra"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-016, FR-TRANSACTIONS-001]
nfr: []
invariants: [INV-004, INV-021]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["refund", "reporting"]
error_code: null
preconditions:
  - "Bank A (BOB) con saldo 1000.00 BOB"
  - "Gasto G1 de 200.00 BOB, categoría Groceries, fecha 2026-03-05 (saldo 800.00 BOB)"
input:
  refund: "50.00 BOB"
  category: "Groceries"
  date: "2026-03-12"
  refund_of: "G1"
steps:
  - "Registrar el reembolso vinculado a G1"
  - "Consultar los totales de marzo por categoría y los ingresos de marzo"
expected_result:
  - "Asiento del reembolso: Bank A +50.00, EXPENSE:BOB -50.00 (split Groceries); suma 0.00 BOB"
  - "La transacción guarda refundOfTransactionId = G1"
  - "Gasto neto de Groceries en marzo = 150.00 BOB"
  - "Ingresos de marzo sin cambios"
  - "Saldo de Bank A = 850.00 BOB"
created: 2026-10-01
updated: 2026-10-02
---

# TC-TRANSACTIONS-REFUND-001 — El reembolso reduce el gasto de la categoría original y no es un ingreso

## Intención

ARCHITECTURE §4.3: reembolso = crédito a EXPENSE con la misma categoría.

## Escenario

```gherkin
Dado un gasto de Groceries de 200.00 BOB el 2026-03-05
Cuando se registra un reembolso de 50.00 BOB para Groceries el 2026-03-12
Entonces el gasto de Groceries de marzo es 150.00 BOB
  Y los ingresos de marzo no cambian
```
