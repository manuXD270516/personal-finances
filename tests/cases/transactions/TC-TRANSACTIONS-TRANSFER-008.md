---
id: TC-TRANSACTIONS-TRANSFER-008
title: Transferencia por QR entre cuentas propias preserva el patrimonio
spec: transactions/transfers
related_specs: []
requirement: Medio de pago en transferencias
scenario: Transferencia por QR entre cuentas propias
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-034
nfr: []
invariants:
- INV-009
priority: medium
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
error_code: null
preconditions:
- Bank A (BOB) con 1000.00 BOB
- Bank B (BOB) con 0.00 BOB
input:
  from: Bank A
  to: Bank B
  amount: "200.00"
  currency: BOB
  paymentMethod: QR
steps:
- Transferir 200.00 BOB de Bank A a Bank B con paymentMethod QR
- Consultar saldos y patrimonio
expected_result:
- Bank A 800.00 BOB
- Bank B 200.00 BOB
- Patrimonio sin cambio
- paymentMethod QR
created: '2026-10-02'
updated: '2026-10-02'
---

# TC-TRANSACTIONS-TRANSFER-008 — Transferencia por QR entre cuentas propias preserva el patrimonio

## Intención

Decisión del owner 2026-10-02 (D27, docs/31).

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB y "Bank B" con 0.00 BOB
Cuando transfiero 200.00 BOB por QR
Entonces "Bank A" queda en 800.00 BOB y "Bank B" en 200.00 BOB
Y el patrimonio no cambia
```
