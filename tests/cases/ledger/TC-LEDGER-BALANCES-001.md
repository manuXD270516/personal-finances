---
id: TC-LEDGER-BALANCES-001
title: El saldo de una cuenta es igual a la suma de sus postings y los snapshots se reconstruyen idénticos
spec: ledger/balances
related_specs: []
requirement: Saldos derivados de los postings
scenario: Saldo de una cuenta bancaria
requirement_status: confirmed
fr: [FR-LEDGER-012, FR-ACCOUNTS-006]
nfr: [NFR-DATA-009]
invariants: [INV-022]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [balances, snapshot]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers
- 'Bank A (BOB) con postings: +1000.00 (saldo inicial), -150.00, +45.50, -300.00'
input:
  account: Bank A
steps:
- Consultar el saldo de Bank A
- Eliminar todas las filas de AccountBalanceSnapshot de W1 (datos derivados)
- Ejecutar la reconstrucción de snapshots
- Consultar el saldo nuevamente
expected_result:
- Saldo = 595.50 BOB (1000.00 - 150.00 + 45.50 - 300.00)
- El snapshot reconstruido es igual al snapshot previo a la eliminación
- El saldo obtenido del snapshot es igual al saldo obtenido de SUM(postings)
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-BALANCES-001 — El saldo de una cuenta es igual a la suma de sus postings y los snapshots se reconstruyen idénticos

## Intención

Los snapshots son una optimización, nunca la fuente de verdad (ARCHITECTURE §4.1).

## Escenario

```gherkin
Dado que "Bank A" tiene postings de +1000.00, -150.00, +45.50 y -300.00 BOB
Cuando se lee su saldo
Entonces el saldo es 595.50 BOB
  Y reconstruir el snapshot de saldo da 595.50 BOB
```
