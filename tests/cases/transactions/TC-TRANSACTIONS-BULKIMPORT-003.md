---
id: TC-TRANSACTIONS-BULKIMPORT-003
title: "Las filas con referencia ya registrada se informan como existentes y no se crean"
spec: transactions/transaction-recording
related_specs: ["imports/import-pipeline", "ledger/journal-posting"]
requirement: "Registro en lote de transacciones importadas"
scenario: "Filas ya registradas en el lote"
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: ["NFR-PERF-007", "NFR-DATA-016"]
invariants: ["INV-014"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "bulk-write", "D152"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Filas ya registradas en el lote\" del delta de add-bulk-imported-transactions"
steps:
  - "un lote de 200 filas trae 20 cuyas referencias ya tienen una transacción no anulada en \"Banco BOB\""
expected_result:
  - "se crean 180 transacciones"
  - "las 20 restantes se informan como existentes con su transacción"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-BULKIMPORT-003 — Las filas con referencia ya registrada se informan como existentes y no se crean

## Intención

El sistema DEBE (MUST) registrar un lote de hasta 1 000 filas importadas de una misma cuenta como una sola unidad: cada fila nueva DEBE (MUST) crear su transacción posteada con su asiento cuadrado por moneda, su auditoría con origen import y como actor quien aprobó, su recorrido de creación y los mismos eventos que publica el registro individual.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando un lote de 200 filas trae 20 cuyas referencias ya tienen una transacción no anulada en "Banco BOB"
Entonces se crean 180 transacciones
  Y las 20 restantes se informan como existentes con su transacción
```

## Notas

- Change: `add-bulk-imported-transactions` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
