---
id: TC-TRANSACTIONS-ARCHIVED-001
title: "Una cuenta archivada no admite nuevos movimientos ni reversas"
spec: transactions/transaction-recording
related_specs: ["accounts/account-management", "ledger/journal-posting"]
requirement: "Cuentas no activas no admiten movimientos"
scenario: "Gasto en una cuenta archivada"
requirement_status: confirmed
fr: [FR-ACCOUNTS-007]
nfr: []
invariants: [INV-026]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["archived-account", "validation"]
error_code: "ACCOUNT_ARCHIVED"
preconditions:
  - "Bank B (BOB) archivada con saldo 0.00 BOB"
  - "Cuenta C (BOB) con gasto posteado T9 de 30.00 BOB; luego la cuenta C se archiva"
input:
  - action: "registrar gasto"
    account: "Bank B"
    amount: "20.00 BOB"
  - action: "anular"
    transaction: "T9"
steps: ["Registrar el gasto en Bank B", "Anular T9"]
expected_result:
  - "Ambas operaciones se rechazan con ACCOUNT_ARCHIVED (409)"
  - "Bank B sigue en 0.00 BOB; T9 sigue posted con su asiento activo; no hay reversa"
  - "Variante: con la cuenta cerrada (closed) el rechazo es ACCOUNT_CLOSED"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-ARCHIVED-001 — Una cuenta archivada no admite nuevos movimientos ni reversas

## Intención

INV-026: las cuentas archivadas no reciben postings, incluidas reversas; hay que reactivarlas primero.

## Escenario

```gherkin
Dado que "Bank B" está archivada
Cuando el usuario registra un gasto de 20.00 BOB en "Bank B"
Entonces se rechaza con el código "ACCOUNT_ARCHIVED"
```
