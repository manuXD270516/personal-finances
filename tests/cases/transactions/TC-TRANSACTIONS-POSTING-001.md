---
id: TC-TRANSACTIONS-POSTING-001
title: "Transacción, asiento, auditoría y eventos se confirman juntos o no se confirma ninguno"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting", "audit/audit-trail"]
requirement: "Posteo atómico con asiento, auditoría y evento"
scenario: "Todo o nada al registrar un gasto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-007, FR-AUDIT-001]
nfr: [NFR-DATA-007]
invariants: [INV-004, INV-029, INV-023]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["atomicity", "outbox", "audit"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers"
  - "Bank A (BOB) con saldo 1000.00 BOB"
  - "Adaptador de LedgerPostingPort con inyección de fallas"
input:
  command: "RecordTransaction EXPENSE 75.00 BOB en Bank A (posted)"
  fault: "el insert de postings lanza una excepción"
steps:
  - "Ejecutar el comando normalmente"
  - "Ejecutarlo de nuevo (otra clave de idempotencia) con la falla habilitada"
expected_result:
  - "Normal: existen la transacción, un JournalEntry con postings que suman 0.00 BOB, una fila de auditoría y dos filas de outbox (transactions.TransactionCreated.v1 y transactions.TransactionPosted.v1) con el mismo correlationId"
  - "Con falla: el comando falla y no existe transacción, asiento, auditoría ni outbox del segundo intento"
  - "Saldo de Bank A = 925.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-POSTING-001 — Transacción, asiento, auditoría y eventos se confirman juntos o no se confirma ninguno

## Intención

FR-TRANSACTIONS-007: el asiento se crea vía puerto síncrono en la misma transacción de BD; un evento sin asiento o un asiento sin auditoría rompe la integridad.

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB
Cuando el usuario registra un gasto posteado de 75.00 BOB
Entonces se confirman juntos la transacción, el asiento, la auditoría y los eventos
Cuando la escritura del asiento falla
Entonces no se confirma nada
```

## Notas

- Complementa TC-AUDIT-ATOMIC-001 (falla en auditoría) con una falla en el ledger.
