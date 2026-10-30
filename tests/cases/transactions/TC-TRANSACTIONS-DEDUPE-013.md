---
id: TC-TRANSACTIONS-DEDUPE-013
title: "Dos filas idénticas sin identificador externo en el mismo archivo crean dos gastos"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Duplicados dentro del mismo archivo"
scenario: "Filas idénticas sin identificador"
requirement_status: provisional
fr: ["FR-IMPORTS-007", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pipeline.dedupe.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "duplicate-detection"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Filas idénticas sin identificador\" del delta de add-import-pipeline"
steps:
  - "un CSV sin columna de referencia trae dos veces \"02/10/2026;PAGO QR CAFÉ;-18,00\""
expected_result:
  - "ambas filas son nuevas y al aprobar se crean dos gastos de 18.00 BOB"
created: 2026-10-29
updated: 2026-10-30
---

# TC-TRANSACTIONS-DEDUPE-013 — Dos filas idénticas sin identificador externo en el mismo archivo crean dos gastos

## Intención

Dentro de un mismo archivo, una fila con el mismo identificador externo único que otra anterior DEBE (MUST) clasificarse como ya importada haciendo referencia a la línea de la primera y NO DEBE (MUST NOT) crearse; las filas idénticas sin identificador externo DEBEN (MUST) seguir siendo filas distintas.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando un CSV sin columna de referencia trae dos veces "02/10/2026;PAGO QR CAFÉ;-18,00"
Entonces ambas filas son nuevas y al aprobar se crean dos gastos de 18.00 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
