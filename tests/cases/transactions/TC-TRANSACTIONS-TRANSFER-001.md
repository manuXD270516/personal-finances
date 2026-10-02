---
id: TC-TRANSACTIONS-TRANSFER-001
title: "Una transferencia entre cuentas de distinta moneda se rechaza en favor de una conversión"
spec: transactions/transfers
related_specs: ["transactions/conversions"]
requirement: "Transferencia entre monedas distintas orientada a conversión"
scenario: "Bolivianos hacia una cuenta en dólares"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-020, FR-TRANSACTIONS-004]
nfr: []
invariants: [INV-002, INV-004]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["transfer", "multi-currency"]
error_code: "TRANSFER_CURRENCY_MISMATCH"
preconditions: ["Bank A (BOB) con saldo 1000.00 BOB", "USD Savings (USD) con saldo 500.00 USD"]
input:
  from: "Bank A"
  to: "USD Savings"
  amount: "100.00 BOB"
steps: ["Intentar la transferencia"]
expected_result:
  - "422 problem+json con code TRANSFER_CURRENCY_MISMATCH; el detail sugiere registrar una conversión"
  - "Saldos sin cambios: 1000.00 BOB y 500.00 USD; nada persistido"
created: 2026-10-01
updated: 2026-10-02
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

## Notas

- El caso de origen = destino se movió a TC-TRANSACTIONS-TRANSFER-003.
