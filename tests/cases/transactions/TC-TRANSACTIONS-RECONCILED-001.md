---
id: TC-TRANSACTIONS-RECONCILED-001
title: "Solo una transacción cleared puede marcarse como reconciliada"
spec: transactions/reconciliation
related_specs: []
requirement: "Marcar una transacción como reconciliada"
scenario: "Reconciliar un gasto confirmado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006]
nfr: []
invariants: [INV-023]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["reconciled"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions: ["Gasto T1 cleared de 150.00 BOB", "Gasto T2 posted de 150.00 BOB"]
input:
  - transaction: "T1"
    status: "RECONCILED"
  - transaction: "T2"
    status: "RECONCILED"
steps: ["Marcar T1 como reconciled", "Intentar marcar T2 como reconciled"]
expected_result:
  - "T1 reconciled sin asientos nuevos ni cambio de saldo"
  - "T2: INVALID_STATUS_TRANSITION; sigue posted"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-RECONCILED-001 — Solo una transacción cleared puede marcarse como reconciliada

## Intención

Phase 1 permite el marcado simple; las sesiones con saldo de extracto llegan en Phase 2 (FR-TRANSACTIONS-030).

## Escenario

```gherkin
Dado un gasto "cleared" de 150.00 BOB
Cuando el usuario lo marca como "reconciled"
Entonces queda "reconciled" sin cambios en el ledger
```
