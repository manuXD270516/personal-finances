---
id: TC-TRANSACTIONS-TRANSFER-007
title: Pago de tarjeta de crédito con QR es una transferencia, no un gasto
spec: transactions/transfers
related_specs: []
requirement: Pago de tarjeta de crédito como transferencia
scenario: Pagar la tarjeta con QR
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-018
- FR-TRANSACTIONS-034
nfr: []
invariants:
- INV-009
- INV-030
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transfer.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- qr
- credit-card
error_code: null
preconditions:
- Bank A (BOB) con saldo 1000.00 BOB
- Credit Card (pasivo BOB) con deuda 350.00 BOB
input:
  from: Bank A
  to: Credit Card
  amount: "350.00"
  currency: BOB
  paymentMethod: QR
steps:
- Registrar transferencia 350.00 BOB de Bank A a Credit Card con paymentMethod QR
- Consultar saldos, gasto del mes y patrimonio
expected_result:
- Bank A queda en 650.00 BOB
- Deuda de Credit Card queda en 0.00 BOB
- El gasto del mes no cambia
- Patrimonio neto sin cambio
created: '2026-10-02'
updated: '2026-10-02'
---

# TC-TRANSACTIONS-TRANSFER-007 — Pago de tarjeta de crédito con QR es una transferencia, no un gasto

## Intención

Decisión del owner 2026-10-02 (D27, docs/31).

## Escenario

```gherkin
Dado "Credit Card" con deuda 350.00 BOB y "Bank A" con 1000.00 BOB
Cuando pago 350.00 BOB con QR desde "Bank A"
Entonces "Bank A" queda en 650.00 BOB y la deuda en 0.00 BOB
Y el pago no se cuenta como gasto
```
