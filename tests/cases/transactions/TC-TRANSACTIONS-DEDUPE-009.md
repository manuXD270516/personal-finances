---
id: TC-TRANSACTIONS-DEDUPE-009
title: "Fusionar una fila con el gasto manual no crea transacción ni modifica el gasto y registra la decisión"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Resolución registrada de un posible duplicado"
scenario: "Fusionar con el gasto manual"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-007"]
nfr: []
invariants: ["INV-014"]
priority: critical
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
input: "Datos del scenario \"Fusionar con el gasto manual\" del delta de add-import-pipeline"
steps:
  - "el EDITOR fusiona la fila \"SUPERMERCADO DEMO\" de 245.30 BOB con el gasto manual de 245.30 BOB del 2026-10-02 y aprueba"
expected_result:
  - "no se crea ninguna transacción para esa fila"
  - "el gasto manual conserva su monto, su descripción, su fecha y su estado posteado"
  - "la decisión queda guardada con el EDITOR, el instante y el puntaje 0.9000"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-009 — Fusionar una fila con el gasto manual no crea transacción ni modifica el gasto y registra la decisión

## Intención

El usuario DEBE (MUST) poder resolver cada posible duplicado conservando ambas (crear la fila), fusionándolos (omitir la fila vinculándola al movimiento existente, sin modificar ese movimiento) o excluyendo la fila sin recordarla; la decisión DEBE (MUST) guardarse con su actor, su instante y el puntaje del candidato elegido.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando el EDITOR fusiona la fila "SUPERMERCADO DEMO" de 245.30 BOB con el gasto manual de 245.30 BOB del 2026-10-02 y aprueba
Entonces no se crea ninguna transacción para esa fila
  Y el gasto manual conserva su monto, su descripción, su fecha y su estado posteado
  Y la decisión queda guardada con el EDITOR, el instante y el puntaje 0.9000
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
