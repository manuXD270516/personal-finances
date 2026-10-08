---
id: TC-TRANSACTIONS-CLEARED-001
title: "Marcar y desmarcar cleared no toca el ledger"
spec: transactions/reconciliation
related_specs: ["ledger/balances"]
requirement: "Marcar una transacción como cleared"
scenario: "Confirmar un gasto contra el extracto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-029, FR-TRANSACTIONS-006]
nfr: []
invariants: [INV-023]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["cleared", "reconciliation"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions:
  - "Gasto posteado T1 de 150.00 BOB en Bank A (saldo 850.00 BOB), asiento E1"
  - "Gasto pendiente T2 de 80.00 BOB"
input:
  - transaction: "T1"
    status: "CLEARED"
  - transaction: "T1"
    status: "POSTED"
  - transaction: "T2"
    status: "CLEARED"
steps: ["Marcar T1 como cleared", "Desmarcar T1", "Intentar marcar T2 como cleared"]
expected_result:
  - "T1 cleared y luego posted; activeEntryId = E1 en todo momento; saldo 850.00 BOB"
  - "Auditoría por cada cambio de estado; sin TransactionPosted adicional"
  - "Cada cambio publica un TransactionCleared (confirmada true/false) además de TransactionUpdated con changedFields = [status]"
  - "T2: INVALID_STATUS_TRANSITION"
created: 2026-10-02
updated: 2026-10-08
---

# TC-TRANSACTIONS-CLEARED-001 — Marcar y desmarcar cleared no toca el ledger

## Intención

cleared es una marca de confirmación bancaria, no un hecho contable (docs/09 §9).

## Cambio (openspec add-reconciliation, 2026-10-08)

Actualizado a la semántica MODIFIED del requirement "Marcar una transacción como cleared": publica además el evento
dedicado `transactions.TransactionCleared.v1` (docs/31 D47; TC-TRANSACTIONS-RECONCILIATION-011) y se rechaza con
`PERIOD_CLOSED` si la fecha de negocio está en un periodo cerrado (docs/33 D65).

## Escenario

```gherkin
Dado un gasto posteado de 150.00 BOB
Cuando el usuario lo marca como "cleared"
Entonces su asiento activo es el mismo
  Y el saldo no cambia
```
