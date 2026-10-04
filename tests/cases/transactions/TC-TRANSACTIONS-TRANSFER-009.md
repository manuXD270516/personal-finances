---
id: TC-TRANSACTIONS-TRANSFER-009
title: "Corregir una transferencia publica TransferRevised y no re-emite TransferCompleted"
spec: transactions/transfers
related_specs: ["audit/lifecycle-timeline","ledger/journal-posting"]
requirement: "Revisión de una transferencia como transición explícita"
scenario: "Corregir el monto de una transferencia"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-036","FR-TRANSACTIONS-018","FR-TRANSACTIONS-008"]
nfr: ["NFR-REL-007"]
invariants: ["INV-009","INV-008"]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle.api.test.ts
  - packages/contexts/transactions/src/application/transfers.service.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["transfer","events","revision"]
error_code: null
preconditions:
  - "\"A\" con 1000.00 BOB y \"B\" con 0.00 BOB"
input: {"transfer":{"from":"A","to":"B","amount":"300.00","currency":"BOB"},"revise":{"amount":"250.00"}}
steps:
  - "Registrar la transferencia posteada"
  - "Corregir el monto a 250.00 BOB"
  - "Leer el outbox"
  - "Entregar dos veces TransferRevised al consumidor de prueba"
expected_result:
  - "Outbox: un único transactions.TransferCompleted.v1 (300.00 BOB) y un único transactions.TransferRevised.v1 con revisionFrom 1, revisionTo 2, amount 250.00 BOB, reversedJournalEntryId, reversalJournalEntryId y journalEntryId"
  - "\"A\" 750.00 BOB, \"B\" 250.00 BOB, patrimonio 1000.00 BOB"
  - "El consumidor aplica TransferRevised una sola vez"
created: 2026-10-03
updated: 2026-10-04
---

# TC-TRANSACTIONS-TRANSFER-009 — Corregir una transferencia publica TransferRevised y no re-emite TransferCompleted

## Intención

Fija la semántica decidida por el owner (D37): completada una vez, revisada por cada edición.

## Escenario

```gherkin
Dada una transferencia de 300.00 BOB de "A" a "B"
Cuando corrijo su monto a 250.00 BOB
Entonces se publicó una única transferencia completada y una única transferencia revisada
  Y los saldos son 750.00 BOB y 250.00 BOB
```

## Notas

- Cubre también el scenario "Reentrega de la transferencia revisada".
- Reemplaza la decisión 6 de add-transfers (re-emisión con upsert).
