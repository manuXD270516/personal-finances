---
id: TC-ACCOUNTS-CRYPTO-001
title: "Una billetera cripto exige moneda cripto y respeta su escala"
spec: accounts/account-management
related_specs: ["fx/market-rates"]
requirement: "Cuentas cripto con moneda cripto"
scenario: "Billetera cripto en moneda fiat"
requirement_status: confirmed
fr: [FR-ACCOUNTS-014]
nfr: []
invariants: [INV-003]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["accounts", "crypto"]
error_code: "ACCOUNT_CURRENCY_KIND_MISMATCH"
preconditions: ["W1 con BOB (FIAT, 2), USDT (CRYPTO, 6) y BTC (CRYPTO, 8) habilitadas"]
input:
  - {name: "Wallet BOB", type: "crypto_wallet", currency: "BOB", expected: "ACCOUNT_CURRENCY_KIND_MISMATCH"}
  - {name: "USDT Wallet 2", type: "crypto_wallet", currency: "USDT", opening: "1.0000001", expected: "AMOUNT_SCALE_EXCEEDED"}
  - {name: "BTC Cold", type: "crypto_wallet", currency: "BTC", opening: "0.01250000", cryptoNetwork: "BTC", expected: "creada"}
steps: ["Crear cada cuenta"]
expected_result:
  - "Wallet BOB se rechaza con ACCOUNT_CURRENCY_KIND_MISMATCH (422)"
  - "USDT Wallet 2 se rechaza con AMOUNT_SCALE_EXCEEDED y no se crea"
  - "BTC Cold se crea con saldo 0.01250000 BTC y red BTC"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-CRYPTO-001 — Una billetera cripto exige moneda cripto y respeta su escala

## Intención

FR-ACCOUNTS-014 (Should): evita billeteras cripto mal denominadas y pérdida de precisión en montos de 6 u 8 decimales.

## Escenario

```gherkin
Cuando el usuario crea una cuenta crypto_wallet en BOB
Entonces se rechaza con ACCOUNT_CURRENCY_KIND_MISMATCH
```
