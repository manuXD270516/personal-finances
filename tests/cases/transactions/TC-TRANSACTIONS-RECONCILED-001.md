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
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["reconciled"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions: ["Gasto T1 cleared de 150.00 BOB", "Gasto T2 posted de 150.00 BOB"]
input:
  - transaction: "T1"
    status: "RECONCILED"
    reconciliationMode: "WITHOUT_STATEMENT"
  - transaction: "T2"
    status: "RECONCILED"
    reconciliationMode: "WITHOUT_STATEMENT"
steps: ["Marcar T1 como reconciled indicando el modo sin extracto", "Intentar marcar T2 como reconciled"]
expected_result:
  - "T1 reconciled en modo sin extracto, sin asientos nuevos ni cambio de saldo"
  - "T2: INVALID_STATUS_TRANSITION; sigue posted"
created: 2026-10-02
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILED-001 — Solo una transacción cleared puede marcarse como reconciliada

## Intención

Phase 1 permite el marcado simple; las sesiones con saldo de extracto llegan en Phase 2 (FR-TRANSACTIONS-030).

## Cambio (openspec add-reconciliation, 2026-10-08)

Actualizado a la semántica MODIFIED del requirement "Marcar una transacción como reconciliada" (docs/33 D74): el marcado
directo ahora exige el modo explícito `reconciliationMode: WITHOUT_STATEMENT` y deja la transacción en ese modo; la
regla "solo desde cleared" no cambia. La variante sin el modo (VALIDATION_FAILED) es TC-TRANSACTIONS-RECONCILIATION-017.

## Escenario

```gherkin
Dado un gasto "cleared" de 150.00 BOB
Cuando el usuario lo marca como "reconciled"
Entonces queda "reconciled" sin cambios en el ledger
```
