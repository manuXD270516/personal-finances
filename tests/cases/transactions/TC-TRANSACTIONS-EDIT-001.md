---
id: TC-TRANSACTIONS-EDIT-001
title: "Editar el monto de una transacción registrada produce una reversa más un nuevo asiento"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting", "audit/audit-trail"]
requirement: "Edición de transacciones registradas"
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
tags: ["edit", "reversal", "optimistic-locking"]
error_code: null
preconditions:
  - "Bank A (BOB) con saldo 1000.00"
  - "Gasto registrado (posted) T1 de 120.00 BOB (asiento E1), versión 1"
input:
  transaction: "T1"
  new_amount: "102.00 BOB"
  if_match_version: 1
steps:
  - "Editar el monto de T1 a 102.00 BOB con versión esperada 1"
  - "Editar T1 nuevamente con la versión obsoleta 1"
expected_result:
  - "Asientos tras la edición: E1 (sin cambios), R1 que revierte E1, E2 con Bank A -102.00 / EXPENSE:BOB +102.00"
  - "Saldo de Bank A = 898.00 BOB (1000.00 - 120.00 + 120.00 - 102.00)"
  - "Versión de T1 = 2; la bitácora de auditoría almacena el antes (120.00) y el después (102.00)"
  - "La edición obsoleta se rechaza con CONCURRENCY_CONFLICT"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-EDIT-001 — Editar el monto de una transacción registrada produce una reversa más un nuevo asiento

## Intención

Correcciones = reversa + nuevo asiento, vinculados (ARCHITECTURE §4.1); el bloqueo optimista evita actualizaciones perdidas.

## Escenario

```gherkin
Dado un gasto registrado "T1" de 120.00 BOB
Cuando el usuario cambia su monto a 102.00 BOB
Entonces se revierte el asiento original y se registra un nuevo asiento de 102.00 BOB
  Y "Bank A" tiene un saldo de 898.00 BOB
```
