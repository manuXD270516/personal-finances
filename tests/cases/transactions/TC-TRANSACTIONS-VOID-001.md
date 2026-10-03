---
id: TC-TRANSACTIONS-VOID-001
title: "Anular una transacción posteada crea una reversa y conserva el asiento original"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting", "audit/audit-trail"]
requirement: "Anulación de transacciones"
scenario: "Anular un gasto posteado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-009, FR-LEDGER-005]
nfr: []
invariants: [INV-004, INV-007, INV-008, INV-023]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["void", "reversal"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions:
  - "Bank A (BOB) con saldo 1000.00 BOB antes de T1"
  - "Gasto posteado T1 de 60.00 BOB con asiento E1 (saldo 940.00 BOB)"
  - "Gasto pendiente T2 de 80.00 BOB"
input:
  void: ["T1", "T2"]
  reason: "registrado por error"
  date: "2026-03-21"
steps:
  - "Anular T1"
  - "Inspeccionar asientos, estado, saldo y eventos"
  - "Anular T2"
  - "Anular T1 nuevamente"
expected_result:
  - "T1 queda void con voidReason y voidedAt; sigue consultable"
  - "Existe R1 REVERSAL con reversesEntryId = E1; E1 sin cambios; ningún asiento activo para T1"
  - "Saldo de Bank A = 1000.00 BOB"
  - "Se publica TransactionVoided con previousStatus POSTED y reversalJournalEntryId = R1"
  - "T2 queda void sin ningún asiento; TransactionVoided con reversalJournalEntryId null"
  - "La segunda anulación de T1 se rechaza con INVALID_STATUS_TRANSITION"
  - "La auditoría registra cada anulación con actor y motivo"
created: 2026-10-01
updated: 2026-10-02
---

# TC-TRANSACTIONS-VOID-001 — Anular una transacción posteada crea una reversa y conserva el asiento original

## Intención

void = reversa (ARCHITECTURE §4.1); no hay borrado físico de datos financieros.

## Escenario

```gherkin
Dado un gasto posteado "T1" de 60.00 BOB
Cuando el usuario anula "T1"
Entonces se crea un asiento de reversa vinculado al asiento original
  Y "Bank A" vuelve a tener 1000.00 BOB
  Y "T1" sigue visible con estado "void"
```

## Notas

- Código de error unificado con el catálogo (docs/10 §9.1): la versión anterior del TC usaba TRANSACTION_ALREADY_VOIDED.
