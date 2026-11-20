---
id: TC-LEDGER-BALANCE-004
title: "Un asiento descuadrado inyectado en una escritura por conjunto revierte los 200 asientos al confirmar"
spec: ledger/journal-posting
related_specs: ["transactions/transaction-recording", "imports/import-pipeline"]
requirement: "Asientos balanceados por moneda"
scenario: "Barrera de base de datos en una escritura por conjunto"
requirement_status: confirmed
fr: [FR-LEDGER-001]
nfr: [NFR-DATA-004]
invariants: [INV-004]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
status: draft
regression_suite: true
phase: 6
tags: [ledger, database, defense-in-depth, bulk-write, stabilize-import-persist-perf, ADR-0034]
error_code: LEDGER_UNBALANCED_ENTRY
preconditions:
  - PostgreSQL 18 vía Testcontainers con todas las migraciones aplicadas
  - La conexión usa el rol de aplicación pf_app (sin BYPASSRLS, no es dueño de las tablas)
  - SET LOCAL app.workspace_id = W1
  - Cuentas ficticias "Banco BOB" (ASSET) y EXPENSE:BOB; ningún dato real del owner (D255, D281)
input:
  entries: 200
  postings_per_entry: ["+18.00 BOB (EXPENSE:BOB)", "-18.00 BOB (Banco BOB)"]
  injected: "asiento 137 con +18.00 BOB y -17.00 BOB"
steps:
  - "BEGIN; insertar los 200 journal_entry con un único INSERT … SELECT FROM unnest y sus 400 postings con otro (el camino de appendMany); COMMIT"
  - "Repetir con los 200 asientos cuadrados"
expected_result:
  - "El primer COMMIT falla con SQLSTATE PF001, que se traduce a LEDGER_UNBALANCED_ENTRY"
  - "No queda ninguna fila de los 200 asientos ni de sus postings"
  - "El segundo COMMIT tiene éxito y deja 200 asientos y 400 postings que suman 0.00 BOB cada uno"
  - "Tras cada COMMIT o ROLLBACK, ledger.pending_entry_check y ledger.pending_check_sentinel no tienen filas (ADR-0034)"
created: 2026-11-20
updated: 2026-11-20
---

# TC-LEDGER-BALANCE-004 — Un asiento descuadrado inyectado en una escritura por conjunto revierte los 200 asientos al confirmar

## Intención

Es la condición de D404 para cambiar el mecanismo de los disparadores: un asiento descuadrado inyectado en un lote escrito por conjunto DEBE (MUST) revertir el lote entero al confirmar, tanto con los disparadores por fila actuales como con la validación por sentencia de [ADR-0034](../../../docs/adr/0034-validacion-por-sentencia-de-los-invariantes-del-ledger.md).

## Escenario

```gherkin
Dado una sesión de base de datos con el rol "pf_app" en el workspace "W1"
Cuando se insertan por conjunto 200 asientos de "+18.00 BOB" y "-18.00 BOB" salvo el asiento 137, que lleva "+18.00 BOB" y "-17.00 BOB", y se confirma
Entonces la confirmación falla con "LEDGER_UNBALANCED_ENTRY"
  Y no queda ninguna fila de los 200 asientos ni de sus postings
```

## Notas

- Change: `stabilize-import-persist-perf` (tarea 7.6, D447). Se escribe y debe pasar **antes** de la migración de ADR-0034, con los disparadores por fila, y seguir en verde después.
- Test sugerido: `packages/contexts/ledger/test/integration/pg-ledger.int.test.ts`, junto a TC-LEDGER-BALANCE-002, con nombre `[TC-LEDGER-BALANCE-004] …`.
