---
id: TC-LEDGER-STRUCTURE-002
title: La base de datos rechaza asientos con menos de dos postings o con montos en cero
spec: ledger/journal-posting
related_specs: []
requirement: Asiento con al menos dos postings distintos de cero
scenario: Posting de monto cero
requirement_status: confirmed
fr: [FR-LEDGER-001]
nfr: [NFR-DATA-004]
invariants: [INV-005]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [ledger, database, defense-in-depth]
error_code: null
preconditions:
- PostgreSQL 18 vía Testcontainers con todas las migraciones aplicadas
- Rol pf_app, SET LOCAL app.workspace_id = W1
input:
  single_posting:
  - +150.00 BOB (EXPENSE:BOB, split s1)
  zero_posting:
  - +150.00 BOB (EXPENSE:BOB, split s1)
  - -150.00 BOB (Efectivo BOB)
  - 0.00 BOB (EQUITY:ADJUSTMENTS:BOB)
steps:
- BEGIN; insertar journal_entry + un único posting vía SQL directo; COMMIT
- BEGIN; insertar journal_entry + los tres postings del caso zero_posting; COMMIT
expected_result:
- El primer COMMIT falla por el constraint trigger diferido de mínimo de postings (SQLSTATE PF005, mapeado a LEDGER_ENTRY_TOO_FEW_POSTINGS)
- La inserción del posting de 0.00 BOB falla por el CHECK amount <> 0
- No quedan filas en ledger.journal_entry ni en ledger.posting para esos asientos
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-STRUCTURE-002 — La base de datos rechaza asientos con menos de dos postings o con montos en cero

## Intención

Defensa en profundidad de INV-005 independiente de la aplicación (docs/08 §5.3 restricción 2).

## Escenario

```gherkin
Dado una sesión con el rol "pf_app" en el workspace "W1"
Cuando se hace commit de un asiento con un único posting de +150.00 BOB
Entonces el commit falla
  Y no existen filas de ese asiento
```

## Notas

- SQLSTATE PF005 propuesto en design.md de add-ledger-core por la colisión de PF002 en docs/08.
