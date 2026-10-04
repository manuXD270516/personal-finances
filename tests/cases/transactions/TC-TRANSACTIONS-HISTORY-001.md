---
id: TC-TRANSACTIONS-HISTORY-001
title: "El detalle de una transacción muestra su historial de cambios en orden"
spec: transactions/transaction-recording
related_specs: ["audit/audit-trail"]
requirement: "Historial de cambios de la transacción"
scenario: "Historial tras editar y anular"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-014, FR-AUDIT-004]
nfr: []
invariants: [INV-029]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/transactions/transactions.test.tsx
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - apps/api/test/api/transactions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["audit", "history"]
error_code: null
preconditions: ["EDITOR autenticado de W1", "Bank A (BOB) con saldo 1000.00 BOB"]
input:
  steps: ["crear gasto 120.00 BOB", "editar a 102.00 BOB", "anular con motivo \"duplicado\""]
steps: ["Ejecutar las tres operaciones", "Consultar el historial de la transacción"]
expected_result:
  - "Tres entradas en orden cronológico: CREATE, UPDATE (amount 120.00 -> 102.00), VOID con motivo \"duplicado\""
  - "Cada entrada tiene actor, occurredAt UTC, versión y correlationId"
  - "Un VIEWER puede consultar el historial; los datos de otro workspace nunca aparecen"
created: 2026-10-02
updated: 2026-10-04
---

# TC-TRANSACTIONS-HISTORY-001 — El detalle de una transacción muestra su historial de cambios en orden

## Intención

El usuario debe poder entender cómo llegó una transacción a su estado actual (FR-TRANSACTIONS-014).

## Escenario

```gherkin
Dado un gasto de 120.00 BOB editado a 102.00 BOB y luego anulado
Cuando el usuario abre su historial
Entonces ve la creación, la edición y la anulación en ese orden
```

## Notas

- A nivel API (2026-10-04, `apps/api/test/api/transactions.api.test.ts`): `GET …/transactions/{id}/history` (VIEWER) y `GET W/audit-log?aggregateType=Transaction&aggregateId=…` (EDITOR) devuelven `created`, `updated` (amount 120.00 → 102.00) y `voided` con motivo, en orden; el historial de la transacción intercala además la auditoría de sus asientos (`ledger.journal_entry.posted`/`reversed`).
