---
id: TC-TRANSACTIONS-TRANSFER-006
title: "TransferCompleted se publica una sola vez al postear la transferencia y nunca estando pendiente"
spec: transactions/transfers
related_specs: ["ledger/journal-posting"]
requirement: "Publicación de transferencia completada"
scenario: "Transferencia pendiente que luego se postea"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-018, FR-TRANSACTIONS-007]
nfr: []
invariants: [INV-023]
priority: high
type: integration
level: event-contract
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transfers.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["transfer", "events", "outbox"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers"
  - "Bank A (BOB) 1000.00 BOB; Bank B (BOB) 0.00 BOB"
input:
  from: "Bank A"
  to: "Bank B"
  amount: "300.00 BOB"
  status: "pending"
steps:
  - "Registrar la transferencia pendiente"
  - "Leer outbox y asientos"
  - "Postearla"
  - "Leer outbox y validar el evento contra contracts/events/transactions/TransferCompleted.v1.schema.json"
expected_result:
  - "Pendiente: outbox con TransactionCreated (PENDING); sin asiento ni TransferCompleted; saldos sin cambio"
  - "Posteada: exactamente un transactions.TransferCompleted.v1 con fromAccountId Bank A, toAccountId Bank B, amount 300.00 BOB, fee null, journalEntryId del asiento, válido contra el schema"
  - "Saldos: Bank A 700.00 BOB, Bank B 300.00 BOB"
created: 2026-10-02
updated: 2026-10-03
---

# TC-TRANSACTIONS-TRANSFER-006 — TransferCompleted se publica una sola vez al postear la transferencia y nunca estando pendiente

## Intención

Goals y Debt reaccionan a TransferCompleted; publicarlo sin asiento o dos veces corrompería aportes y pagos.

## Escenario

```gherkin
Dada una transferencia pendiente de 300.00 BOB de "Bank A" a "Bank B"
Cuando se postea
Entonces se publica exactamente un evento de transferencia completada
  Y antes de postearla no existía ninguno
```

## Notas

- 2026-10-03 (docs/31 D37, change `add-lifecycle-timeline`): `TransferCompleted` se publica **una sola vez** por transferencia; una edición financiera ya no lo re-emite, publica `TransferRevised.v1` (ver TC-TRANSACTIONS-TRANSFER-009). Este TC no cambia de expectativa.
