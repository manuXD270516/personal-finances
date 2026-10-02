---
id: TC-ACCOUNTS-CURRENCY-001
title: "Se rechaza registrar un monto en una moneda distinta de la moneda de la cuenta"
spec: accounts/account-management
related_specs: ["transactions/transaction-recording"]
requirement: "Una sola moneda por cuenta"
scenario: "Gasto en moneda distinta"
requirement_status: confirmed
fr: [FR-ACCOUNTS-002, FR-TRANSACTIONS-001]
nfr: []
invariants: [INV-002, INV-006]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["multi-currency"]
error_code: "CURRENCY_MISMATCH"
preconditions:
  - "Cuenta \"USD Savings\" (savings, ASSET, USD) con saldo 500.00 USD"
  - "EUR no habilitada en W1"
input:
  account: "USD Savings"
  expense: "50.00"
  currency: "BOB"
  date: "2026-03-15"
  new_account: {name: "Euro Cash", type: "cash", currency: "EUR"}
steps:
  - "Registrar un gasto de 50.00 BOB en USD Savings"
  - "Crear la cuenta Euro Cash en EUR"
expected_result:
  - "El gasto se rechaza con CURRENCY_MISMATCH"
  - "No se persiste ninguna transacción, asiento, entrada de auditoría ni evento de outbox"
  - "El saldo de USD Savings se mantiene en 500.00 USD"
  - "La creación de Euro Cash se rechaza con CURRENCY_NOT_ENABLED"
created: 2026-10-01
updated: 2026-10-02
---

# TC-ACCOUNTS-CURRENCY-001 — Se rechaza registrar un monto en una moneda distinta de la moneda de la cuenta

## Intención

Cada cuenta contable tiene exactamente una moneda (ARCHITECTURE §4.1, INV-006); los movimientos entre monedas distintas deben ser conversiones.

## Escenario

```gherkin
Dado que la cuenta "USD Savings" está denominada en USD con 500.00 USD
Cuando el usuario registra un gasto de 50.00 BOB en "USD Savings"
Entonces se rechaza con el código "CURRENCY_MISMATCH"
  Y el saldo sigue en 500.00 USD
```

## Notas

- El código se alinea con el catálogo docs/10 §9.1 (`CURRENCY_MISMATCH`); antes figuraba `ACCOUNT_CURRENCY_MISMATCH`, que no existe en el catálogo.
