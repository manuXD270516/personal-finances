---
id: TC-ACCOUNTS-LEDGERLINK-001
title: "Crear una cuenta crea exactamente una cuenta contable del mismo tipo y moneda"
spec: accounts/account-management
related_specs: ["ledger/journal-posting"]
requirement: "Cuenta respaldada por una cuenta contable"
scenario: null
requirement_status: provisional
fr: [FR-ACCOUNTS-001]
nfr: []
invariants: [INV-002]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["accounts", "ledger"]
error_code: "ACCOUNT_CURRENCY_IMMUTABLE"
preconditions: ["Workspace W1, PostgreSQL mediante Testcontainers"]
input:
  - name: "Bank C"
    type: "checking"
    currency: "BOB"
    expected_ledger_kind: "ASSET"
  - name: "Card Y"
    type: "credit_card"
    currency: "BOB"
    expected_ledger_kind: "LIABILITY"
steps:
  - "Crear cada cuenta"
  - "Registrar una transacción en Bank C"
  - "Intentar cambiar la moneda de Bank C a USD"
expected_result:
  - "Cada cuenta tiene exactamente un LedgerAccount vinculado con el tipo esperado y la misma moneda"
  - "Ambas filas se escriben en la misma transacción de base de datos"
  - "Cambiar la moneda de una cuenta con postings se rechaza con ACCOUNT_CURRENCY_IMMUTABLE"
created: 2026-10-01
updated: 2026-10-01
---

# TC-ACCOUNTS-LEDGERLINK-001 — Crear una cuenta crea exactamente una cuenta contable del mismo tipo y moneda

## Intención

Account ↔ LedgerAccount es 1:1 (ARCHITECTURE §4.1); el vínculo debe ser atómico y la moneda estable.

## Escenario

```gherkin
Cuando el usuario crea la cuenta corriente "Bank C" en BOB
Entonces exactamente una cuenta contable ASSET en BOB queda vinculada a "Bank C"
```
