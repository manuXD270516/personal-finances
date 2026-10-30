---
id: TC-TRANSACTIONS-DEDUPE-012
title: "Un identificador repetido dentro del archivo se clasifica como ya importado y crea una sola transacción"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Duplicados dentro del mismo archivo"
scenario: "Mismo identificador dos veces en un archivo"
requirement_status: provisional
fr: ["FR-IMPORTS-007", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: domain
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/application/duplicate-matching.test.ts
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
input: "Datos del scenario \"Mismo identificador dos veces en un archivo\" del delta de add-import-pipeline"
steps:
  - "un OFX trae en las líneas 40 y 95 el movimiento con identificador \"A1\" de 50.00 BOB"
expected_result:
  - "la fila de la línea 95 se clasifica como ya importada con referencia a la línea 40"
  - "al aprobar se crea una sola transacción de 50.00 BOB"
created: 2026-10-29
updated: 2026-10-30
---

# TC-TRANSACTIONS-DEDUPE-012 — Un identificador repetido dentro del archivo se clasifica como ya importado y crea una sola transacción

## Intención

Dentro de un mismo archivo, una fila con el mismo identificador externo único que otra anterior DEBE (MUST) clasificarse como ya importada haciendo referencia a la línea de la primera y NO DEBE (MUST NOT) crearse; las filas idénticas sin identificador externo DEBEN (MUST) seguir siendo filas distintas.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando un OFX trae en las líneas 40 y 95 el movimiento con identificador "A1" de 50.00 BOB
Entonces la fila de la línea 95 se clasifica como ya importada con referencia a la línea 40
  Y al aprobar se crea una sola transacción de 50.00 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
