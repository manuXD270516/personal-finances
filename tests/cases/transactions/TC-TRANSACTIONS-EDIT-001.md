---
id: TC-TRANSACTIONS-EDIT-001
title: "Editar el monto de una transacción registrada produce una reversa más un nuevo asiento"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting", "audit/audit-trail"]
requirement: "Edición financiera de una transacción posteada"
scenario: "Corregir el monto de un gasto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-008, FR-LEDGER-005]
nfr: []
invariants: [INV-004, INV-007, INV-008, INV-023, INV-024]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
  - packages/contexts/transactions/test/integration/pg-transactions.int.test.ts
  - tests/e2e/specs/transactions.spec.ts
status: automated
regression_suite: true
phase: 1
tags: ["edit", "reversal"]
error_code: null
preconditions:
  - "Bank A (BOB) con saldo 1000.00 BOB antes de T1"
  - "Gasto posteado T1 de 120.00 BOB (asiento E1), revisión 1, versión 1"
  - "Gasto T4 de 60.00 BOB en estado cleared"
input:
  transaction: "T1"
  new_amount: "102.00 BOB"
  if_match_version: 1
  cleared_case: "T4 cambia a 65.00 BOB"
steps:
  - "Editar el monto de T1 a 102.00 BOB con versión esperada 1"
  - "Inspeccionar asientos, saldo, revisión y auditoría"
  - "Editar el monto de T4 a 65.00 BOB"
expected_result:
  - "Asientos de T1: E1 sin cambios; R1 REVERSAL con reversesEntryId = E1 (EXPENSE:BOB -120.00, Bank A +120.00); E2 STANDARD revisión 2 (EXPENSE:BOB +102.00, Bank A -102.00)"
  - "Saldo de Bank A = 898.00 BOB (1000.00 - 120.00 + 120.00 - 102.00)"
  - "T1: revisión 2, versión 2, estado posted; la auditoría guarda antes 120.00 y después 102.00"
  - "Se publica TransactionPosted con revision 2 y supersedesJournalEntryId = E1"
  - "T4 queda en posted con un asiento activo de 65.00 BOB"
created: 2026-10-01
updated: 2026-10-03
---

# TC-TRANSACTIONS-EDIT-001 — Editar el monto de una transacción registrada produce una reversa más un nuevo asiento

## Intención

Correcciones = reversa + nuevo asiento, vinculados (ARCHITECTURE §4.1); un cleared editado debe re-confirmarse (docs/09 §11).

## Escenario

```gherkin
Dado un gasto posteado "T1" de 120.00 BOB
Cuando el usuario cambia su monto a 102.00 BOB
Entonces se revierte el asiento original y se registra un nuevo asiento de 102.00 BOB
  Y "Bank A" tiene un saldo de 898.00 BOB
```

## Notas

- El rechazo por versión obsoleta se movió a TC-TRANSACTIONS-CONCURRENCY-001 (requirement "Bloqueo optimista en la edición").
