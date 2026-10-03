---
id: TC-TRANSACTIONS-CURRENCY-001
title: "Se rechaza un gasto cuya moneda difiere de la moneda de la cuenta"
spec: transactions/transaction-recording
related_specs: ["accounts/account-management", "transactions/conversions"]
requirement: "Moneda de la transacción igual a la moneda de la cuenta"
scenario: "Gasto en bolivianos sobre una cuenta en dólares"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-004]
nfr: []
invariants: [INV-002, INV-006]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["multi-currency", "validation"]
error_code: "CURRENCY_MISMATCH"
preconditions: ["USD Savings (ASSET, USD) con saldo 500.00 USD"]
input:
  account: "USD Savings"
  amount: "50.00"
  currency: "BOB"
  date: "2026-03-15"
steps: ["Registrar el gasto"]
expected_result:
  - "Se rechaza con CURRENCY_MISMATCH (422)"
  - "No se persiste transacción, asiento, auditoría ni evento de outbox"
  - "Saldo de USD Savings = 500.00 USD"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CURRENCY-001 — Se rechaza un gasto cuya moneda difiere de la moneda de la cuenta

## Intención

Una cuenta tiene una sola moneda; los movimientos entre monedas son conversiones (FR-TRANSACTIONS-004).

## Escenario

```gherkin
Dado que "USD Savings" está en USD con 500.00 USD
Cuando el usuario registra un gasto de 50.00 BOB en "USD Savings"
Entonces se rechaza con el código "CURRENCY_MISMATCH"
  Y el saldo sigue en 500.00 USD
```

## Notas

- TC-ACCOUNTS-CURRENCY-001 cubre la misma regla desde accounts/account-management con el código ACCOUNT_CURRENCY_MISMATCH (no catalogado); ver contradicción reportada en add-transaction-recording.
