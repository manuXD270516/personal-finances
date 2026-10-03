---
id: TC-TRANSACTIONS-QR-002
title: Cobro recibido por QR se registra como ingreso
spec: transactions/transaction-recording
related_specs: []
requirement: Pagos y cobros con QR
scenario: Cobro recibido por QR
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
- Categoría Freelance
input:
  kind: INCOME
  account: Bank A
  amount: "300.00"
  currency: BOB
  paymentMethod: QR
  counterparty: Cliente Demo
  category: Freelance
  businessDate: "2026-03-14"
steps:
- Registrar ingreso 300.00 BOB por QR de Cliente Demo, categoría Freelance, fecha 2026-03-14
- Consultar saldo e ingresos de marzo
expected_result:
- Bank A queda en 1300.00 BOB
- Ingreso de marzo en Freelance aumenta 300.00 BOB
- paymentMethod QR
created: '2026-10-02'
updated: 2026-10-03
---

# TC-TRANSACTIONS-QR-002 — Cobro recibido por QR se registra como ingreso

## Intención

Decisión del owner 2026-10-02 (D27, docs/31).

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB
Cuando recibo 300.00 BOB por QR como "Freelance"
Entonces "Bank A" queda en 1300.00 BOB
Y el ingreso de marzo en "Freelance" aumenta 300.00 BOB
```
