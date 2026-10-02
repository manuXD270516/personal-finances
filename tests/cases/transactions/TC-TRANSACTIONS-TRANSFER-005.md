---
id: TC-TRANSACTIONS-TRANSFER-005
title: "Una transferencia desde o hacia una cuenta archivada o cerrada se rechaza"
spec: transactions/transfers
related_specs: ["accounts/account-management"]
requirement: "Cuentas no activas en transferencias"
scenario: "Transferir hacia una cuenta archivada"
requirement_status: confirmed
fr: [FR-ACCOUNTS-007]
nfr: []
invariants: [INV-026]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["transfer", "archived-account"]
error_code: "ACCOUNT_ARCHIVED"
preconditions: ["Bank A (BOB) 1000.00 BOB", "Bank B (BOB) archivada", "Cuenta D (BOB) cerrada"]
input:
  - from: "Bank A"
    to: "Bank B"
    amount: "100.00 BOB"
  - from: "Bank A"
    to: "D"
    amount: "100.00 BOB"
steps: ["Intentar cada transferencia"]
expected_result:
  - "Hacia Bank B: 409 ACCOUNT_ARCHIVED"
  - "Hacia D: 409 ACCOUNT_CLOSED"
  - "Bank A sigue en 1000.00 BOB; nada persistido"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-TRANSFER-005 — Una transferencia desde o hacia una cuenta archivada o cerrada se rechaza

## Intención

INV-026 aplicado a ambas patas de una transferencia.

## Escenario

```gherkin
Dado que "Bank B" está archivada
Cuando el usuario transfiere 100.00 BOB de "Bank A" a "Bank B"
Entonces se rechaza con el código "ACCOUNT_ARCHIVED"
```
