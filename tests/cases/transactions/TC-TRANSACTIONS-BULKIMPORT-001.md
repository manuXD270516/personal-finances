---
id: TC-TRANSACTIONS-BULKIMPORT-001
title: "Un lote de 200 filas crea 200 transacciones con asientos cuadrados, auditoría y 600 eventos"
spec: transactions/transaction-recording
related_specs: ["imports/import-pipeline", "ledger/journal-posting"]
requirement: "Registro en lote de transacciones importadas"
scenario: "Lote de 200 gastos e ingresos"
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: ["NFR-PERF-007", "NFR-DATA-016"]
invariants: ["INV-004", "INV-021", "INV-023", "INV-029"]
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
input: "Datos del scenario \"Lote de 200 gastos e ingresos\" del delta de add-bulk-imported-transactions"
steps:
  - "\"Banco BOB\" tiene saldo contable 4000.00 BOB y la EDITOR \"Ana\" aprueba un import cuyo lote tiene 150 salidas que suman 3750.00 BOB y 50 entradas que suman 5000.00 BOB"
expected_result:
  - "existen 200 transacciones posteadas con origen import y 200 asientos, cada uno con suma 0.00 BOB"
  - "el saldo contable de \"Banco BOB\" es 5250.00 BOB"
  - "hay 200 registros de auditoría de creación con origen import y actor \"Ana\""
  - "se publicaron 200 eventos de transacción creada, 200 de transacción posteada y 200 de asiento posteado"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-BULKIMPORT-001 — Un lote de 200 filas crea 200 transacciones con asientos cuadrados, auditoría y 600 eventos

## Intención

El sistema DEBE (MUST) registrar un lote de hasta 1 000 filas importadas de una misma cuenta como una sola unidad: cada fila nueva DEBE (MUST) crear su transacción posteada con su asiento cuadrado por moneda, su auditoría con origen import y como actor quien aprobó, su recorrido de creación y los mismos eventos que publica el registro individual.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando "Banco BOB" tiene saldo contable 4000.00 BOB y la EDITOR "Ana" aprueba un import cuyo lote tiene 150 salidas que suman 3750.00 BOB y 50 entradas que suman 5000.00 BOB
Entonces existen 200 transacciones posteadas con origen import y 200 asientos, cada uno con suma 0.00 BOB
  Y el saldo contable de "Banco BOB" es 5250.00 BOB
  Y hay 200 registros de auditoría de creación con origen import y actor "Ana"
  Y se publicaron 200 eventos de transacción creada, 200 de transacción posteada y 200 de asiento posteado
```

## Notas

- Change: `add-bulk-imported-transactions` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
