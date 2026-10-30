---
id: TC-TRANSACTIONS-DEDUPE-010
title: "Conservar ambas crea el gasto importado sin tocar el manual y la reimportación lo reconoce"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Resolución registrada de un posible duplicado"
scenario: "Conservar ambas"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-007"]
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
input: "Datos del scenario \"Conservar ambas\" del delta de add-import-pipeline"
steps:
  - "el EDITOR decide crear la fila a pesar del candidato, aprueba y luego reimporta el mismo archivo"
expected_result:
  - "la primera importación crea un gasto de 245.30 BOB y el gasto manual sigue igual"
  - "en la reimportación la fila se clasifica como ya importada"
created: 2026-10-29
updated: 2026-10-30
---

# TC-TRANSACTIONS-DEDUPE-010 — Conservar ambas crea el gasto importado sin tocar el manual y la reimportación lo reconoce

## Intención

El usuario DEBE (MUST) poder resolver cada posible duplicado conservando ambas (crear la fila), fusionándolos (omitir la fila vinculándola al movimiento existente, sin modificar ese movimiento) o excluyendo la fila sin recordarla; la decisión DEBE (MUST) guardarse con su actor, su instante y el puntaje del candidato elegido.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando el EDITOR decide crear la fila a pesar del candidato, aprueba y luego reimporta el mismo archivo
Entonces la primera importación crea un gasto de 245.30 BOB y el gasto manual sigue igual
  Y en la reimportación la fila se clasifica como ya importada
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
