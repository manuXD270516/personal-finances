---
id: TC-TRANSACTIONS-AMOUNT-001
title: "Se rechazan montos con más decimales que la escala de la moneda sin redondear"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Escala del monto según la moneda"
scenario: "Tres decimales en bolivianos"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-005]
nfr: [NFR-DATA-001]
invariants: [INV-001, INV-003]
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["money", "scale", "validation"]
error_code: "AMOUNT_SCALE_EXCEEDED"
preconditions:
  - "Bank A (BOB, escala 2) con saldo 1000.00 BOB"
  - "USDT Wallet (USDT, escala 6) con saldo 100.000000 USDT"
input:
  - account: "Bank A"
    amount: "10.555"
    currency: "BOB"
  - account: "USDT Wallet"
    amount: "1.234567"
    currency: "USDT"
steps:
  - "Registrar el gasto en BOB con 3 decimales"
  - "Registrar el gasto en USDT con 6 decimales"
expected_result:
  - "BOB: 422 problem+json con code AMOUNT_SCALE_EXCEEDED y errors[0].pointer = \"/amount/amount\"; nada persistido"
  - "USDT: 201; saldo de USDT Wallet = 98.765433 USDT"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-AMOUNT-001 — Se rechazan montos con más decimales que la escala de la moneda sin redondear

## Intención

El dinero nunca se redondea en silencio al ingresar (INV-003).

## Escenario

```gherkin
Dado que BOB tiene escala 2 y USDT escala 6
Cuando el usuario registra un gasto de 10.555 BOB
Entonces se rechaza con el código "AMOUNT_SCALE_EXCEEDED"
Cuando el usuario registra un gasto de 1.234567 USDT
Entonces se registra y "USDT Wallet" queda en 98.765433 USDT
```
