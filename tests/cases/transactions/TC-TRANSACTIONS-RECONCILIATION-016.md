---
id: TC-TRANSACTIONS-RECONCILIATION-016
title: "Conciliar sin extracto un gasto en efectivo: sin ledger, auditado y distinguible"
spec: transactions/reconciliation
related_specs: ["audit/lifecycle-timeline", "audit/audit-trail"]
requirement: "Conciliación sin extracto"
scenario: "Conciliar sin extracto un gasto en efectivo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-030, FR-AUDIT-001]
nfr: []
invariants: [INV-029, INV-033]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/test/integration/pg-reconciliations.int.test.ts
  - tests/e2e/specs/reconciliation.spec.ts
status: automated
regression_suite: true
phase: 2
tags: ["reconciled", "without-statement", "audit"]
error_code: null
preconditions:
  - "Cuenta \"Caja BOB\" (ASSET, BOB, ACTIVE, sin sesiones) con saldo inicial 500.00 BOB"
  - "Gasto C1 de 80.00 BOB del 2026-03-12 en \"Caja BOB\""
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "C1 cleared; saldo de \"Caja BOB\" 420.00 BOB"
input:
  patch: {"status": "RECONCILED", "reconciliationMode": "WITHOUT_STATEMENT"}
steps:
  - "Conciliar sin extracto C1 como EDITOR"
  - "Consultar C1, sus asientos, la auditoría, el recorrido y el outbox"
expected_result:
  - "C1 RECONCILED con reconciliationMode WITHOUT_STATEMENT y systemFlags [RECONCILED_WITHOUT_STATEMENT]"
  - "Un único asiento activo; \"Caja BOB\" sigue en 420.00 BOB"
  - "Auditoría transactions.transaction.reconciled_without_statement con before/after de status y reconciliationMode y el actor"
  - "Transición RECONCILE_WITHOUT_STATEMENT (no RECONCILE) en la misma transacción de BD"
  - "TransactionUpdated.v1 con changedFields [status, reconciliationMode]"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-016 — Conciliar sin extracto un gasto en efectivo: sin ledger, auditado y distinguible

## Intención

Decisión del owner docs/33 D74: el modo sin extracto es explícito, auditado y distinguible del cotejo contra extracto; sin este caso un "reconciled" sin extracto sería indistinguible de uno cotejado.

## Escenario

```gherkin
Dado un gasto cleared de 80.00 BOB en "Caja BOB" (saldo 420.00 BOB)
Cuando el usuario lo concilia sin extracto
Entonces queda reconciled en modo sin extracto con su único asiento
  Y la auditoría registra el modo y el actor
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
