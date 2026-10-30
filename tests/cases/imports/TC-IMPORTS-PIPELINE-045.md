---
id: TC-IMPORTS-PIPELINE-045
title: "Marcar una transferencia hacia una cuenta de otra moneda se rechaza con TRANSFER_CURRENCY_MISMATCH"
spec: imports/import-pipeline
related_specs: ["transactions/transfers"]
requirement: "Filas como transferencia o conversión entre cuentas propias"
scenario: "Transferencia a una cuenta de otra moneda"
requirement_status: provisional
fr: ["FR-IMPORTS-009", "FR-TRANSACTIONS-021", "FR-FX-008"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/domain/row-edits.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.review.test.ts
  - packages/contexts/transactions/src/application/record-imported-transactions.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: TRANSFER_CURRENCY_MISMATCH
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
  - "Cuenta \"Caja USD\" (ASSET, USD)"
input: "Datos del scenario \"Transferencia a una cuenta de otra moneda\" del delta de add-import-pipeline"
steps:
  - "el EDITOR marca una fila de \"Banco BOB\" como transferencia a \"Caja USD\""
expected_result:
  - "se rechaza con `TRANSFER_CURRENCY_MISMATCH` y la fila no cambia"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-045 — Marcar una transferencia hacia una cuenta de otra moneda se rechaza con TRANSFER_CURRENCY_MISMATCH

## Intención

El OWNER o EDITOR DEBERÍA (SHOULD) poder marcar en la vista previa una fila como transferencia hacia o desde otra cuenta propia de la misma moneda, o como conversión con otra cuenta propia de otra moneda indicando el monto recibido o entregado en ella; al aprobar, la fila DEBE (MUST) crear esa transferencia o conversión en lugar de un gasto o ingreso, la conversión DEBE (MUST) quedar vinculada a la tasa de referencia vigente al instante del movimiento y la pata creada en la otra cuenta DEBE (MUST) ser candidata de duplicado cuando se importe el extracto de esa cuenta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
  Y Cuenta "Caja USD" (ASSET, USD)
Cuando el EDITOR marca una fila de "Banco BOB" como transferencia a "Caja USD"
Entonces se rechaza con `TRANSFER_CURRENCY_MISMATCH` y la fila no cambia
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
