---
id: TC-IMPORTS-PIPELINE-001
title: "Un import de 4 filas y uno de 5 000 publican los mismos 2 eventos propios"
spec: imports/import-pipeline
related_specs: ["platform/event-delivery"]
requirement: "Volumen de eventos de un import grande"
scenario: "Eventos propios independientes de la cantidad de filas"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "events", "D152"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Eventos propios independientes de la cantidad de filas\" del delta de add-bulk-imported-transactions"
steps:
  - "un EDITOR importa y aprueba un CSV de 4 filas y otro de 5 000 filas en la misma cuenta"
expected_result:
  - "cada importación publicó los mismos 2 eventos propios, de aprobación y de fin"
  - "ninguno de los eventos propios corresponde a una fila"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-001 — Un import de 4 filas y uno de 5 000 publican los mismos 2 eventos propios

## Intención

Un import de 5 000 filas DEBE (MUST) llegar a la vista previa en 30 segundos o menos y persistirse en 20 segundos o menos en el entorno de referencia, y los eventos que generan sus transacciones DEBEN (MUST) quedar procesados por cada consumidor en 120 segundos o menos; el import NO DEBE (MUST NOT) publicar eventos propios por fila: la cantidad de eventos propios de una importación DEBE (MUST) ser la misma con 4 filas que con 5 000.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando un EDITOR importa y aprueba un CSV de 4 filas y otro de 5 000 filas en la misma cuenta
Entonces cada importación publicó los mismos 2 eventos propios, de aprobación y de fin
  Y ninguno de los eventos propios corresponde a una fila
```

## Notas

- Change: `add-bulk-imported-transactions` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
