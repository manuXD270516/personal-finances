---
id: TC-TRANSACTIONS-DEDUPE-014
title: "Deshacer un import olvida sus vínculos y la reimportación vuelve a mostrar la fila fusionada como posible duplicado"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Vínculos que dejan de valer al deshacer un import"
scenario: "Deshacer olvida la fusión"
requirement_status: provisional
fr: ["FR-IMPORTS-012", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: medium
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
input: "Datos del scenario \"Deshacer olvida la fusión\" del delta de add-import-pipeline"
steps:
  - "una importación creó 2 gastos y fusionó una fila con el gasto manual de 245.30 BOB, se deshace y luego se reimporta el mismo archivo"
expected_result:
  - "las 2 filas de los gastos anulados son nuevas"
  - "la fila fusionada vuelve a ser un posible duplicado del gasto manual"
created: 2026-10-29
updated: 2026-10-30
---

# TC-TRANSACTIONS-DEDUPE-014 — Deshacer un import olvida sus vínculos y la reimportación vuelve a mostrar la fila fusionada como posible duplicado

## Intención

Deshacer una importación DEBE (MUST) dejar sin efecto los vínculos de sus filas, tanto los de las transacciones que creó como los de las filas que fusionó con movimientos existentes, de modo que una importación posterior del mismo archivo vuelva a mostrar esas filas como nuevas o como posibles duplicados.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando una importación creó 2 gastos y fusionó una fila con el gasto manual de 245.30 BOB, se deshace y luego se reimporta el mismo archivo
Entonces las 2 filas de los gastos anulados son nuevas
  Y la fila fusionada vuelve a ser un posible duplicado del gasto manual
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
