---
id: TC-LEDGER-PERIOD-002
title: La base de datos rechaza asientos con fecha dentro de un periodo bloqueado
spec: ledger/journal-posting
related_specs: [planning/month-closing]
requirement: Los periodos bloqueados rechazan asientos
scenario: Escritura directa en la base de datos durante el bloqueo
requirement_status: confirmed
fr: [FR-LEDGER-011, FR-PLANNING-005]
nfr: []
invariants: [INV-015]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: [period-closing, database, defense-in-depth]
error_code: PERIOD_CLOSED
preconditions:
- PostgreSQL vía Testcontainers, rol pf_app, workspace W1
- Fila en ledger.period_lock para 2026-08-01..2026-08-31 en W1
- Sin bloqueo para W2
input:
- workspace: W1
  entry_date: '2026-08-31'
  postings:
  - +45.00 BOB
  - -45.00 BOB
- workspace: W1
  entry_date: '2026-09-01'
  postings:
  - +45.00 BOB
  - -45.00 BOB
- workspace: W2
  entry_date: '2026-08-15'
  postings:
  - +45.00 BOB
  - -45.00 BOB
steps:
- Insertar cada asiento vía SQL directo y hacer COMMIT
- Eliminar el bloqueo (unlockPeriod) y repetir el primer asiento
expected_result:
- El asiento de W1 del 2026-08-31 falla con SQLSTATE PF004 (mapeado a PERIOD_CLOSED)
- El asiento de W1 del 2026-09-01 y el de W2 del 2026-08-15 se aceptan
- Tras desbloquear, el asiento del 2026-08-31 se acepta
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-PERIOD-002 — La base de datos rechaza asientos con fecha dentro de un periodo bloqueado

## Intención

Cierra la carrera cierre ↔ posteo: aunque la aplicación omitiera el chequeo, la base de datos no admite asientos en un periodo bloqueado (docs/08 §5.3 restricción 6).

## Escenario

```gherkin
Dado que agosto de 2026 está bloqueado en "W1"
Cuando se inserta directamente un asiento con fecha 2026-08-31
Entonces la base de datos rechaza la inserción
```
