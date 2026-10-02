---
id: TC-TRANSACTIONS-VOID-001
title: "Anular una transacción registrada crea una reversa y conserva el asiento original"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Anulación de transacciones"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-007, FR-LEDGER-002]
nfr: []
invariants: [INV-004]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["void", "reversal"]
error_code: "TRANSACTION_ALREADY_VOIDED"
preconditions:
  - "Bank A (BOB) con saldo 1000.00"
  - "Gasto registrado (posted) T1 de 60.00 BOB con asiento E1"
input:
  void: "T1"
  date: "2026-03-21"
steps: ["Anular T1", "Inspeccionar los asientos y el estado", "Anular T1 nuevamente"]
expected_result:
  - "Estado de T1 = voided"
  - "Existe un asiento de reversa R1 con reverses_entry_id = E1; E1 sin cambios"
  - "Saldo de Bank A = 1000.00 BOB"
  - "La segunda anulación se rechaza con TRANSACTION_ALREADY_VOIDED"
  - "La bitácora de auditoría registra la anulación con el actor y el motivo"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-VOID-001 — Anular una transacción registrada crea una reversa y conserva el asiento original

## Intención

void = reversa (ARCHITECTURE §4.1); no hay borrado físico de datos financieros.

## Escenario

```gherkin
Dado un gasto registrado "T1" de 60.00 BOB
Cuando el usuario anula "T1"
Entonces se crea un asiento de reversa vinculado al asiento original
  Y "Bank A" vuelve a tener 1000.00 BOB
  Y "T1" sigue visible con estado "voided"
```
