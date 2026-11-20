---
id: TC-TRANSACTIONS-SPLIT-007
title: "La base de datos rechaza al confirmar unos splits que no suman, también en revisiones y en lotes"
spec: transactions/splits
related_specs: ["transactions/transaction-recording", "ledger/journal-posting"]
requirement: "Los splits suman exactamente el total"
scenario: "Barrera de base de datos de los splits al confirmar"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-026]
nfr: [NFR-DATA-004]
invariants: [INV-021]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
status: draft
regression_suite: true
phase: 6
tags: [splits, database, defense-in-depth, bulk-write, stabilize-import-persist-perf, ADR-0034]
error_code: SPLITS_DO_NOT_SUM
preconditions:
  - PostgreSQL 18 vía Testcontainers con todas las migraciones aplicadas
  - La conexión usa el rol de aplicación pf_app (sin BYPASSRLS, no es dueño de las tablas)
  - SET LOCAL app.workspace_id = W1
  - Gasto ficticio "PAGO QR CAFÉ" de 150.00 BOB en "Banco BOB" con un split vigente de 150.00 BOB
input:
  revision: "monto 150.00 → 175.00 BOB; split vigente reemplazado (superseded_in_revision = 2); split nuevo de 175.00 BOB"
  amount_only: "monto 150.00 → 175.00 BOB sin tocar los splits"
  batch: "200 gastos de 18.00 BOB, el gasto 59 con un split de 17.00 BOB"
steps:
  - "BEGIN; UPDATE del monto; UPDATE del split vigente; INSERT del split nuevo (tres sentencias); COMMIT"
  - "BEGIN; UPDATE del monto solamente; COMMIT"
  - "BEGIN; INSERT por conjunto de las 200 transacciones y de sus 200 splits; COMMIT"
  - "Repetir los casos con un pago de préstamo LOAN_PAYMENT (la parte que no es principal es gasto), como en pg-loans.int.test.ts"
expected_result:
  - "La revisión en tres sentencias confirma aunque el estado intermedio no sumaba"
  - "El cambio de monto sin splits falla al confirmar con SQLSTATE 23514 y la restricción transaction_splits_sum_ck; la transacción conserva 150.00 BOB"
  - "El lote con el split inyectado falla al confirmar y no deja ninguna de las 200 transacciones"
  - "El mensaje del error conserva el formato actual (splits of transaction … sum … but the expected amount is …)"
  - "Las colas de ADR-0034 (txn.pending_splits_check y txn.pending_check_sentinel) quedan vacías tras cada caso"
created: 2026-11-20
updated: 2026-11-20
---

# TC-TRANSACTIONS-SPLIT-007 — La base de datos rechaza al confirmar unos splits que no suman, también en revisiones y en lotes

## Intención

INV-021 tiene una barrera en la base de datos que se evalúa al confirmar: admite los estados intermedios de una revisión en varias sentencias y revierte el lote entero si un split no suma. La validación por sentencia de [ADR-0034](../../../docs/adr/0034-validacion-por-sentencia-de-los-invariantes-del-ledger.md) DEBE (MUST) conservar esa conducta, el SQLSTATE y el nombre de la restricción, incluida la lógica de `LOAN_PAYMENT` y `LOAN_DISBURSEMENT`.

## Escenario

```gherkin
Dado un gasto de 150.00 BOB con un split vigente de 150.00 BOB en el workspace "W1"
Cuando en una transacción se cambia el monto a 175.00 BOB, se reemplaza el split y se inserta uno de 175.00 BOB, y se confirma
Entonces la confirmación tiene éxito
  Y si solo se cambia el monto a 175.00 BOB, la confirmación falla por "transaction_splits_sum_ck" y el gasto conserva 150.00 BOB
  Y un lote de 200 gastos con un split de 17.00 BOB inyectado falla al confirmar y no deja ninguna transacción
```

## Notas

- Change: `stabilize-import-persist-perf` (tarea 7.6, D447). Se escribe y debe pasar antes y después de la migración de ADR-0034.
- Test sugerido: `packages/contexts/transactions/test/integration/pg-transactions.int.test.ts` (los casos de préstamo, en `pg-loans.int.test.ts`).
