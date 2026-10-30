---
id: TC-TRANSACTIONS-BULKIMPORT-005
title: "El registro en lote y el individual producen el mismo resultado observable para las mismas filas"
spec: transactions/transaction-recording
related_specs: ["imports/import-pipeline", "ledger/journal-posting"]
requirement: "Equivalencia entre el registro en lote y el individual"
scenario: "Tres filas por los dos caminos"
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: ["NFR-DATA-016"]
invariants: ["INV-001", "INV-003", "INV-004", "INV-029"]
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/record-imported-transactions.test.ts
  - packages/contexts/transactions/test/integration/pg-transactions.int.test.ts
  - packages/contexts/ledger/src/application/ledger.service.test.ts
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
input: "Datos del scenario \"Tres filas por los dos caminos\" del delta de add-bulk-imported-transactions"
steps:
  - "en dos workspaces idénticos se registran las filas \"02/10/2026 PAGO QR CAFÉ 18.00 BOB de salida\", \"02/10/2026 PAGO QR CAFÉ 18.00 BOB de salida\" y \"05/10/2026 ABONO SUELDO 8000.00 BOB de entrada\", en uno por el registro en lote y en el otro de a una"
expected_result:
  - "ambos workspaces tienen 2 gastos de 18.00 BOB \"Sin categoría\" y 1 ingreso de 8000.00 BOB \"Ingreso sin categoría\", posteados"
  - "los movimientos del ledger por cuenta y moneda son iguales y cada asiento suma 0.00 BOB"
  - "los registros de auditoría, el recorrido y los eventos coinciden salvo identificadores e instantes"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-BULKIMPORT-005 — El registro en lote y el individual producen el mismo resultado observable para las mismas filas

## Intención

Para los mismos datos de entrada, el registro en lote de filas importadas DEBE (MUST) producir el mismo resultado observable que registrar cada fila como una transacción individual de origen import: mismo tipo, estado, fecha, cuenta, monto, moneda, categoría y descripción; los mismos movimientos del ledger por cuenta y moneda; los mismos campos de auditoría y de recorrido; y los mismos tipos y contenidos de eventos, salvo identificadores e instantes.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando en dos workspaces idénticos se registran las filas "02/10/2026 PAGO QR CAFÉ 18.00 BOB de salida", "02/10/2026 PAGO QR CAFÉ 18.00 BOB de salida" y "05/10/2026 ABONO SUELDO 8000.00 BOB de entrada", en uno por el registro en lote y en el otro de a una
Entonces ambos workspaces tienen 2 gastos de 18.00 BOB "Sin categoría" y 1 ingreso de 8000.00 BOB "Ingreso sin categoría", posteados
  Y los movimientos del ledger por cuenta y moneda son iguales y cada asiento suma 0.00 BOB
  Y los registros de auditoría, el recorrido y los eventos coinciden salvo identificadores e instantes
```

## Notas

- Change: `add-bulk-imported-transactions` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
- PBT con fast-check: además del ejemplo del scenario, lotes generados con montos y escalas válidas, filas idénticas y descripciones con caracteres especiales (decisión 5 de design.md).
- 2026-10-29: PBT con fast-check (60 corridas, timeout de 60 s) sobre lotes de 1 a 25 filas con montos de 0.01 a 99 999 999.99, fechas del mes, descripciones con comillas, barras, acentos y CJK, y filas idénticas; compara transacciones, splits, legs, vínculos, asientos, eventos, auditoría y recorrido normalizando identificadores. `pg-transactions.int.test.ts` compara además las filas que escribe `insertMany` con las de `insert` + `linkEntry` en PostgreSQL.
