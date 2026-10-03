---
id: TC-LEDGER-IDEMPOTENCY-001
title: Registrar dos veces el mismo origen y revisión produce un único asiento
spec: ledger/journal-posting
related_specs: []
requirement: Registro idempotente respecto al origen
scenario: Reintento del registro de una transacción
requirement_status: confirmed
fr: [FR-LEDGER-010]
nfr: []
invariants: [INV-023]
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/application/ledger.service.test.ts
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [ledger, idempotency]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers, workspace W1
- Bank A (BOB) con saldo 1000.00 BOB
input:
  source: T1 revisión 1
  postings:
  - EXPENSE:BOB +120.00 (s1)
  - Bank A -120.00
  attempts: 2
steps:
- Ejecutar PostJournalEntry dos veces con el mismo sourceRef (también en dos transacciones concurrentes)
expected_result:
- Ambas llamadas devuelven el mismo journalEntryId
- Existe un único asiento para T1 revisión 1 y un único evento en el outbox
- Saldo de Bank A = 880.00 BOB
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-IDEMPOTENCY-001 — Registrar dos veces el mismo origen y revisión produce un único asiento

## Intención

FR-LEDGER-010: los reintentos (red, worker, doble clic) no deben duplicar asientos.

## Escenario

```gherkin
Dado la transacción "T1" revisión 1 de 120.00 BOB
Cuando se solicita dos veces su asiento
Entonces existe un único asiento
  Y "Bank A" tiene 880.00 BOB
```
