---
id: TC-LEDGER-STRUCTURE-003
title: "Un asiento con un solo posting en una escritura por conjunto falla al confirmar y con SET CONSTRAINTS ALL IMMEDIATE"
spec: ledger/journal-posting
related_specs: ["identity/workspace-portability"]
requirement: "Asiento con al menos dos postings distintos de cero"
scenario: "Barrera de base de datos para un asiento sin postings suficientes"
requirement_status: confirmed
fr: [FR-LEDGER-001]
nfr: [NFR-DATA-004]
invariants: [INV-005]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
status: draft
regression_suite: true
phase: 6
tags: [ledger, database, defense-in-depth, bulk-write, stabilize-import-persist-perf, ADR-0034]
error_code: LEDGER_ENTRY_TOO_FEW_POSTINGS
preconditions:
  - PostgreSQL 18 vía Testcontainers con todas las migraciones aplicadas
  - La conexión usa el rol de aplicación pf_app (sin BYPASSRLS, no es dueño de las tablas)
  - SET LOCAL app.workspace_id = W1
  - Cuentas ficticias "Banco BOB" (ASSET) y EXPENSE:BOB
input:
  entries:
    - "A: +18.00 BOB (EXPENSE:BOB), -18.00 BOB (Banco BOB)"
    - "B: +18.00 BOB (EXPENSE:BOB), -18.00 BOB (Banco BOB)"
    - "C: +18.00 BOB (EXPENSE:BOB)"
steps:
  - "BEGIN; insertar los 3 journal_entry con un INSERT por conjunto y los 5 postings con otro; COMMIT"
  - "BEGIN; insertar las mismas filas; SET CONSTRAINTS ALL IMMEDIATE (como el importador de portabilidad)"
  - "BEGIN; SAVEPOINT s; insertar un asiento cuadrado; ROLLBACK TO s; insertar el asiento C solo; COMMIT"
expected_result:
  - "El primer COMMIT falla con SQLSTATE PF005 (LEDGER_ENTRY_TOO_FEW_POSTINGS) y no queda ninguna fila de los 3 asientos"
  - "SET CONSTRAINTS ALL IMMEDIATE falla en ese momento con PF005, antes de confirmar"
  - "El savepoint revertido no deja la validación sin correr: el COMMIT falla con PF005"
  - "Las colas de ADR-0034 quedan vacías tras cada caso"
created: 2026-11-20
updated: 2026-11-20
---

# TC-LEDGER-STRUCTURE-003 — Un asiento con un solo posting en una escritura por conjunto falla al confirmar y con SET CONSTRAINTS ALL IMMEDIATE

## Intención

La base de datos defiende INV-005 en cuatro situaciones: cuando el asiento llega en una escritura por conjunto, cuando se fuerza la evaluación inmediata (verificación del importador de portabilidad) y cuando parte de la transacción se revierte con un savepoint. Cubre los modos de disparo de la validación diferida de [ADR-0034](../../../docs/adr/0034-validacion-por-sentencia-de-los-invariantes-del-ledger.md).

## Escenario

```gherkin
Dado una sesión de base de datos con el rol "pf_app" en el workspace "W1"
Cuando se insertan por conjunto 3 asientos, dos cuadrados y uno con solo "+18.00 BOB", y se confirma
Entonces la confirmación falla con "LEDGER_ENTRY_TOO_FEW_POSTINGS"
  Y no queda ninguna fila de los 3 asientos
  Y con las mismas filas "SET CONSTRAINTS ALL IMMEDIATE" falla antes de confirmar con el mismo código
```

## Notas

- Change: `stabilize-import-persist-perf` (tarea 7.6, D447). Se escribe y debe pasar antes y después de la migración de ADR-0034.
- Test sugerido: `packages/contexts/ledger/test/integration/pg-ledger.int.test.ts`.
