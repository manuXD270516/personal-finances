---
id: TC-LEDGER-IMMUTABILITY-001
title: Los postings y asientos no pueden actualizarse ni eliminarse a nivel de base de datos
spec: ledger/journal-posting
related_specs: []
requirement: Ledger de solo inserción (append-only)
scenario: Intento de modificar un posting a nivel de base de datos
requirement_status: confirmed
fr: [FR-LEDGER-005]
nfr: [NFR-DATA-005]
invariants: [INV-007]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [immutability, database, defense-in-depth]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers, migraciones aplicadas
- Rol pf_app, workspace W1
- Un asiento registrado E1 con los postings P1 (+120.00 BOB) y P2 (-120.00 BOB)
input:
  statements:
  - UPDATE ledger.posting SET amount = 100 WHERE id = P1
  - DELETE FROM ledger.posting WHERE id = P2
  - UPDATE ledger.journal_entry SET entry_date = '2026-01-01' WHERE id = E1
  - DELETE FROM ledger.journal_entry WHERE id = E1
  - TRUNCATE ledger.posting
steps:
- Ejecutar cada sentencia como pf_app en su propia transacción
expected_result:
- Cada sentencia falla (privilegio no otorgado o trigger de inmutabilidad)
- P1, P2 y E1 quedan sin cambios después
- Si la falla llega a la aplicación se mapea a INTERNAL_ERROR + métrica (PF003/42501 son siempre bugs; design.md §Decisiones 3, docs/31 D19)
created: 2026-10-01
updated: 2026-10-03
---

# TC-LEDGER-IMMUTABILITY-001 — Los postings y asientos no pueden actualizarse ni eliminarse a nivel de base de datos

## Intención

El modelo append-only lo impone la base de datos, no solo la convención, protegiendo el historial frente a bugs o SQL manual.

## Escenario

```gherkin
Dado un asiento registrado "E1"
Cuando el rol de aplicación intenta hacer UPDATE o DELETE de sus postings
Entonces la base de datos rechaza la sentencia
  Y los postings quedan sin cambios
```
