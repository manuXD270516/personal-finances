---
id: TC-ACCOUNTS-CURRENCY-001
title: "Se rechaza registrar un monto en una moneda distinta de la moneda de la cuenta"
spec: accounts/account-management
related_specs: ["transactions/transaction-recording"]
requirement: "Una sola moneda por cuenta"
scenario: null
requirement_status: provisional
fr: [FR-ACCOUNTS-001, FR-TRANSACTIONS-001]
nfr: []
invariants: [INV-002, INV-004]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["multi-currency"]
error_code: "ACCOUNT_CURRENCY_MISMATCH"
preconditions: ["Cuenta \"USD Savings\" (ASSET, USD) con saldo 500.00 USD"]
input:
  account: "USD Savings"
  expense: "50.00"
  currency: "BOB"
  date: "2026-03-15"
steps: ["Registrar un gasto de 50.00 BOB en USD Savings"]
expected_result:
  - "Se rechaza con ACCOUNT_CURRENCY_MISMATCH"
  - "No se persiste ninguna transacción, asiento, entrada de auditoría ni evento de outbox"
  - "El saldo de USD Savings se mantiene en 500.00 USD"
created: 2026-10-01
updated: 2026-10-01
---

# TC-ACCOUNTS-CURRENCY-001 — Se rechaza registrar un monto en una moneda distinta de la moneda de la cuenta

## Intención

Cada cuenta contable tiene exactamente una moneda (ARCHITECTURE §4.1); los movimientos entre monedas distintas deben ser conversiones.

## Escenario

```gherkin
Dado que la cuenta "USD Savings" está denominada en USD
Cuando el usuario registra un gasto de 50.00 BOB en "USD Savings"
Entonces se rechaza con el código "ACCOUNT_CURRENCY_MISMATCH"
```
