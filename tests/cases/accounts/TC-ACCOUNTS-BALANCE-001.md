---
id: TC-ACCOUNTS-BALANCE-001
title: "El saldo de la cuenta se deriva de sus movimientos y no puede editarse directamente"
spec: accounts/account-management
related_specs: ["ledger/balances"]
requirement: "Saldo derivado del ledger"
scenario: "Intento de editar el saldo"
requirement_status: confirmed
fr: [FR-ACCOUNTS-006]
nfr: []
invariants: [INV-022]
priority: critical
type: integration
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["accounts", "balance"]
error_code: "VALIDATION_FAILED"
preconditions: ["Bank A (bank, BOB) abierta con 1000.00 BOB", "Gasto de 75.00 BOB registrado en Bank A"]
input:
  read: "GET /accounts/<Bank A>"
  edit: "PATCH /accounts/<Bank A> con body {\"balance\": {\"amount\": \"2000.00\", \"currency\": \"BOB\"}}"
steps: ["Leer la cuenta", "Intentar fijar el saldo con PATCH", "Leer de nuevo"]
expected_result:
  - "El saldo mostrado es 925.00 BOB, igual a la suma de postings de su ledger account"
  - "El PATCH se rechaza con VALIDATION_FAILED"
  - "El saldo sigue siendo 925.00 BOB y no se crea ningún asiento"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-BALANCE-001 — El saldo de la cuenta se deriva de sus movimientos y no puede editarse directamente

## Intención

FR-ACCOUNTS-006 e INV-022: el saldo nunca vive en la cuenta; editarlo rompería la cuadratura con el ledger.

## Escenario

```gherkin
Dado "Bank A" abierta con 1000.00 BOB y un gasto de 75.00 BOB
Cuando el usuario intenta fijar su saldo en 2000.00 BOB
Entonces se rechaza con VALIDATION_FAILED
  Y el saldo sigue en 925.00 BOB
```
