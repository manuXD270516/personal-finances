---
id: TC-TRANSACTIONS-BULKIMPORT-004
title: "Dos lotes simultáneos con las mismas referencias dejan una sola transacción viva por referencia"
spec: transactions/transaction-recording
related_specs: ["imports/import-pipeline", "ledger/journal-posting"]
requirement: "Registro en lote de transacciones importadas"
scenario: "Dos lotes simultáneos con las mismas referencias"
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: ["NFR-PERF-007", "NFR-DATA-016"]
invariants: ["INV-014"]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-imported-transactions.api.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "bulk-write", "D152"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Dos lotes simultáneos con las mismas referencias\" del delta de add-bulk-imported-transactions"
steps:
  - "dos lotes con las mismas 200 referencias de \"Banco BOB\" se registran al mismo tiempo"
expected_result:
  - "cada referencia tiene exactamente una transacción no anulada"
  - "la suma de creadas entre ambos lotes es 200"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-BULKIMPORT-004 — Dos lotes simultáneos con las mismas referencias dejan una sola transacción viva por referencia

## Intención

El sistema DEBE (MUST) registrar un lote de hasta 1 000 filas importadas de una misma cuenta como una sola unidad: cada fila nueva DEBE (MUST) crear su transacción posteada con su asiento cuadrado por moneda, su auditoría con origen import y como actor quien aprobó, su recorrido de creación y los mismos eventos que publica el registro individual.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando dos lotes con las mismas 200 referencias de "Banco BOB" se registran al mismo tiempo
Entonces cada referencia tiene exactamente una transacción no anulada
  Y la suma de creadas entre ambos lotes es 200
```

## Notas

- Change: `add-bulk-imported-transactions` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
- 2026-10-29: automatizado con dos lotes simultáneos de las mismas 200 referencias; `RecordImportedTransactions` serializa los lotes de una cuenta con un candado transaccional (`ImportedRefReader.lockAccount`) y el segundo ve las referencias del primero como existentes; el índice único `transaction_import_ref_uk` sigue como barrera.
