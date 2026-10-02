---
id: TC-TRANSACTIONS-TRANSFER-001
title: "Una transferencia entre cuentas de distinta moneda se rechaza en favor de una conversión"
spec: transactions/transfers
related_specs: ["transactions/conversions"]
requirement: "Transferencia entre cuentas propias"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-003]
nfr: []
invariants: [INV-002, INV-004]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["transfer", "multi-currency"]
error_code: "TRANSFER_CURRENCY_MISMATCH"
preconditions: ["Bank A (BOB) con saldo 1000.00", "USD Savings (USD) con saldo 500.00"]
input:
  - from: "Bank A"
    to: "USD Savings"
    amount: "100.00 BOB"
  - from: "Bank A"
    to: "Bank A"
    amount: "100.00 BOB"
steps: ["Intentar cada transferencia"]
expected_result:
  - "La transferencia entre monedas distintas se rechaza con TRANSFER_CURRENCY_MISMATCH (el problem detail sugiere una conversión)"
  - "La transferencia a la misma cuenta se rechaza con TRANSFER_SAME_ACCOUNT"
  - "Saldos sin cambios"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-TRANSFER-001 — Una transferencia entre cuentas de distinta moneda se rechaza en favor de una conversión

## Intención

Los movimientos entre monedas distintas deben pasar por conversiones con patas FX_TRADING y metadatos de precio.

## Escenario

```gherkin
Dado que "Bank A" está en BOB y "USD Savings" está en USD
Cuando el usuario transfiere 100.00 BOB de "Bank A" a "USD Savings"
Entonces se rechaza con el código "TRANSFER_CURRENCY_MISMATCH"
```
