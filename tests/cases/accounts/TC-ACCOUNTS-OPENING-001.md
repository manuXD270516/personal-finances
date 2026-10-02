---
id: TC-ACCOUNTS-OPENING-001
title: "El saldo inicial genera un asiento de apertura balanceado contra el patrimonio de apertura"
spec: accounts/account-management
related_specs: ["ledger/journal-posting", "transactions/transaction-recording"]
requirement: "Saldo inicial registrado como asiento de apertura"
scenario: "Apertura de un pasivo"
requirement_status: confirmed
fr: [FR-ACCOUNTS-004]
nfr: []
invariants: [INV-004, INV-003, INV-022]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["accounts", "opening-balance", "ledger"]
error_code: null
preconditions: ["Workspace W1 vacío con BOB y USDT habilitadas"]
input:
  - {name: "Banco BOB", type: "bank", currency: "BOB", opening: "10000.00", date: "2026-01-01"}
  - {name: "Visa BOB", type: "credit_card", currency: "BOB", opening_owed: "2000.00", date: "2026-01-01"}
  - {name: "USDT Wallet", type: "crypto_wallet", currency: "USDT", opening: "100.000000", date: "2026-01-01"}
  - {name: "Bank B", type: "savings", currency: "BOB", opening: "0.00", date: "2026-01-01"}
steps: ["Crear cada cuenta con su saldo inicial", "Leer asientos, saldos y patrimonio neto"]
expected_result:
  - "Banco BOB: asiento OPENING fechado 2026-01-01 con +10000.00 BOB en la cuenta y -10000.00 BOB en EQUITY:OPENING_BALANCE:BOB"
  - "Visa BOB: asiento OPENING con -2000.00 BOB en la cuenta y +2000.00 BOB en EQUITY:OPENING_BALANCE:BOB; se presenta como adeudado 2000.00 BOB"
  - "USDT Wallet: asiento con +100.000000 USDT en la cuenta y -100.000000 USDT en EQUITY:OPENING_BALANCE:USDT; suma 0.000000 USDT"
  - "Bank B: ningún asiento; saldo 0.00 BOB"
  - "Patrimonio neto en BOB = 8000.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-OPENING-001 — El saldo inicial genera un asiento de apertura balanceado contra el patrimonio de apertura

## Intención

docs/09 §6.7: el saldo con que la cuenta entra al sistema es un hecho contable; sin asiento, el saldo no derivaría del ledger (INV-022).

## Escenario

```gherkin
Cuando el usuario crea "Banco BOB" con 10000.00 BOB y "Visa BOB" adeudando 2000.00 BOB al 2026-01-01
Entonces cada una tiene un asiento de apertura balanceado en BOB
  Y el patrimonio neto es 8000.00 BOB
```
