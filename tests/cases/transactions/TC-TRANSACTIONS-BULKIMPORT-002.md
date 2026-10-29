---
id: TC-TRANSACTIONS-BULKIMPORT-002
title: "Una fila en un periodo cerrado rechaza el lote completo sin crear ninguna transacción"
spec: transactions/transaction-recording
related_specs: ["imports/import-pipeline", "ledger/journal-posting"]
requirement: "Registro en lote de transacciones importadas"
scenario: "Una fila en periodo cerrado rechaza el lote"
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: ["NFR-PERF-007", "NFR-DATA-016"]
invariants: ["INV-015", "INV-029"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "bulk-write", "D152"]
error_code: PERIOD_CLOSED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Periodo \"2026-08\" cerrado"
input: "Datos del scenario \"Una fila en periodo cerrado rechaza el lote\" del delta de add-bulk-imported-transactions"
steps:
  - "el periodo \"2026-08\" está cerrado y un lote de 200 filas trae una fila del 2026-08-15"
expected_result:
  - "el lote se rechaza con `PERIOD_CLOSED`"
  - "no existe ninguna de sus 200 transacciones y el saldo de \"Banco BOB\" no cambia"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-BULKIMPORT-002 — Una fila en un periodo cerrado rechaza el lote completo sin crear ninguna transacción

## Intención

El sistema DEBE (MUST) registrar un lote de hasta 1 000 filas importadas de una misma cuenta como una sola unidad: cada fila nueva DEBE (MUST) crear su transacción posteada con su asiento cuadrado por moneda, su auditoría con origen import y como actor quien aprobó, su recorrido de creación y los mismos eventos que publica el registro individual.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Periodo "2026-08" cerrado
Cuando el periodo "2026-08" está cerrado y un lote de 200 filas trae una fila del 2026-08-15
Entonces el lote se rechaza con `PERIOD_CLOSED`
  Y no existe ninguna de sus 200 transacciones y el saldo de "Banco BOB" no cambia
```

## Notas

- Change: `add-bulk-imported-transactions` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
