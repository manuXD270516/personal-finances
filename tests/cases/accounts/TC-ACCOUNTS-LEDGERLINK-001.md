---
id: TC-ACCOUNTS-LEDGERLINK-001
title: "Cada cuenta queda respaldada por exactamente una cuenta contable de su naturaleza y moneda"
spec: accounts/account-management
related_specs: ["ledger/journal-posting"]
requirement: "Cuenta respaldada por una cuenta contable"
scenario: "Primer movimiento de una cuenta bancaria"
requirement_status: confirmed
fr: [FR-ACCOUNTS-003]
nfr: []
invariants: [INV-006]
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "ledger"]
error_code: null
preconditions: ["Workspace W1, PostgreSQL mediante Testcontainers"]
input:
  - name: "Bank C"
    type: "bank"
    currency: "BOB"
    first_movement: "ingreso de 200.00 BOB"
    expected_ledger_kind: "ASSET"
  - name: "Card Y"
    type: "credit_card"
    currency: "BOB"
    opening_balance_owed: "100.00"
    expected_ledger_kind: "LIABILITY"
steps:
  - "Crear cada cuenta"
  - "Registrar el primer movimiento de cada una (ingreso en Bank C; saldo inicial en Card Y)"
  - "Registrar en paralelo dos movimientos más sobre Bank C"
expected_result:
  - "Cada cuenta tiene exactamente un ledger account vinculado con la naturaleza esperada y la misma moneda"
  - "El ledger account se crea en la misma transacción de base de datos que el primer posting"
  - "Los movimientos concurrentes no crean un segundo ledger account para Bank C"
  - "Saldo de Bank C = 200.00 BOB; Card Y adeuda 100.00 BOB"
created: 2026-10-01
updated: 2026-10-04
---

# TC-ACCOUNTS-LEDGERLINK-001 — Cada cuenta queda respaldada por exactamente una cuenta contable de su naturaleza y moneda

## Intención

Account ↔ LedgerAccount es 1:1 (ARCHITECTURE §4.1); el vínculo se crea por get-or-create al primer posting (ARCHITECTURE §7) y debe ser único aun con concurrencia. La inmutabilidad de moneda se verifica en TC-ACCOUNTS-CURRENCY-002.

## Escenario

```gherkin
Cuando el usuario crea la cuenta bancaria "Bank C" en BOB y registra un ingreso de 200.00 BOB
Entonces exactamente una cuenta contable de activo en BOB queda vinculada a "Bank C"
  Y su saldo es 200.00 BOB
```

## Notas

- Verificado 2026-10-04: el get-or-create concurrente del ledger account lo cubre además [TC-LEDGER-CHART-002] (packages/contexts/ledger/test/integration/pg-ledger.int.test.ts).
