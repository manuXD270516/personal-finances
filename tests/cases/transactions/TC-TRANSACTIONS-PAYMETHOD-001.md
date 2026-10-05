---
id: TC-TRANSACTIONS-PAYMETHOD-001
title: El medio de pago se persiste, filtra y no altera el ledger
spec: transactions/transaction-recording
related_specs: []
requirement: Medio de pago de la transacción
scenario: Mismo gasto con distinto medio de pago
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-034
nfr: []
invariants:
- INV-033
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/transactions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- payment-method
- qr
error_code: null
preconditions:
- EDITOR autenticado de W1
- Bank A (BOB) con saldo 1000.00 BOB
- Categoría Groceries
input:
  expenses:
  - amount: "45.90"
    currency: BOB
    paymentMethod: QR
  - amount: "45.90"
    currency: BOB
    paymentMethod: DEBIT_CARD
  filter:
    paymentMethod: QR
steps:
- Registrar gasto 45.90 BOB con paymentMethod QR
- Registrar gasto 45.90 BOB con paymentMethod DEBIT_CARD
- Listar filtrando paymentMethod=QR
- Comparar los asientos de ambos gastos
expected_result:
- Bank A queda en 908.20 BOB
- Los dos asientos tienen los mismos postings y montos
- El filtro QR devuelve solo el primer gasto
created: '2026-10-02'
updated: 2026-10-05
---

# TC-TRANSACTIONS-PAYMETHOD-001 — El medio de pago se persiste, filtra y no altera el ledger

## Intención

Decisión del owner 2026-10-02 (D27, docs/31).

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB
Cuando registro un gasto de 45.90 BOB con QR y otro de 45.90 BOB con tarjeta de débito
Entonces "Bank A" queda en 908.20 BOB
Y los asientos de ambos gastos son equivalentes
Y filtrar por QR devuelve solo el primero
```
