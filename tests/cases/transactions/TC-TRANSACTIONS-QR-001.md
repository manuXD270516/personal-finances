---
id: TC-TRANSACTIONS-QR-001
title: Compra en comercio pagada con QR se registra como gasto de la cuenta de origen
spec: transactions/transaction-recording
related_specs: []
requirement: Pagos y cobros con QR
scenario: Compra en comercio pagada con QR
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-035
nfr: []
invariants:
- INV-004
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - tests/e2e/specs/transactions.spec.ts
status: automated
regression_suite: false
phase: 1
tags:
- qr
error_code: null
preconditions:
- EDITOR autenticado de W1
- Bank A (BOB) con saldo 1000.00 BOB
- Categoría Health
- Contraparte Farmacia Demo
input:
  kind: EXPENSE
  account: Bank A
  amount: "85.50"
  currency: BOB
  paymentMethod: QR
  counterparty: Farmacia Demo
  category: Health
  businessDate: "2026-03-12"
steps:
- Registrar gasto 85.50 BOB, paymentMethod QR, contraparte Farmacia Demo, categoría Health, fecha 2026-03-12
- Consultar saldo, gasto de marzo en Health y la transacción
expected_result:
- Bank A queda en 914.50 BOB
- Gasto de marzo en Health aumenta 85.50 BOB
- La transacción tiene paymentMethod QR y contraparte Farmacia Demo
- El asiento cuadra en BOB
created: '2026-10-02'
updated: 2026-10-03
---

# TC-TRANSACTIONS-QR-001 — Compra en comercio pagada con QR se registra como gasto de la cuenta de origen

## Intención

Decisión del owner 2026-10-02 (D27, docs/31).

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB
Cuando pago 85.50 BOB con QR a "Farmacia Demo" en "Health"
Entonces "Bank A" queda en 914.50 BOB
Y el gasto de marzo en "Health" aumenta 85.50 BOB
```
