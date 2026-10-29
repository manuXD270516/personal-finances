---
id: TC-TRANSACTIONS-DEDUPE-011
title: "Excluir una fila no la recuerda y la reimportación vuelve a mostrarla como posible duplicado"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Resolución registrada de un posible duplicado"
scenario: "Excluir sin recordar"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-007"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "duplicate-detection"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Excluir sin recordar\" del delta de add-import-pipeline"
steps:
  - "el EDITOR excluye la fila, aprueba y luego reimporta el mismo archivo"
expected_result:
  - "no se crea ninguna transacción para esa fila"
  - "en la reimportación la fila vuelve a ser un posible duplicado del gasto manual"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-011 — Excluir una fila no la recuerda y la reimportación vuelve a mostrarla como posible duplicado

## Intención

El usuario DEBE (MUST) poder resolver cada posible duplicado conservando ambas (crear la fila), fusionándolos (omitir la fila vinculándola al movimiento existente, sin modificar ese movimiento) o excluyendo la fila sin recordarla; la decisión DEBE (MUST) guardarse con su actor, su instante y el puntaje del candidato elegido.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando el EDITOR excluye la fila, aprueba y luego reimporta el mismo archivo
Entonces no se crea ninguna transacción para esa fila
  Y en la reimportación la fila vuelve a ser un posible duplicado del gasto manual
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
