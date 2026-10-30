---
id: TC-IMPORTS-PIPELINE-056
title: "Reimportar los extractos de los tres meses crea 0 transacciones"
spec: imports/import-pipeline
related_specs: []
requirement: "Extractos solapados de varios formatos sin duplicados"
scenario: "Reimportar los tres meses"
requirement_status: provisional
fr: ["FR-IMPORTS-007", "FR-IMPORTS-010", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.lifecycle.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline", "exit-criteria"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Reimportar los tres meses\" del delta de add-import-pipeline"
steps:
  - "el usuario vuelve a importar \"enero-15feb.csv\" y \"feb-mar.ofx\" y aprueba ambas importaciones"
expected_result:
  - "todas las filas se clasifican como ya importadas y se crean 0 transacciones"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-056 — Reimportar los extractos de los tres meses crea 0 transacciones

## Intención

Importar extractos de una misma cuenta en formatos distintos y con periodos que se solapan DEBE (MUST) dejar exactamente una transacción por movimiento real cuando el usuario resuelve los posibles duplicados que el sistema le muestra, y volver a importar cualquiera de esos archivos DEBE (MUST) crear 0 transacciones.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el usuario vuelve a importar "enero-15feb.csv" y "feb-mar.ofx" y aprueba ambas importaciones
Entonces todas las filas se clasifican como ya importadas y se crean 0 transacciones
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
- PBT: para cualquier secuencia de imports de archivos ya importados (CSV, OFX, QIF, JSON), import(f); import(f) ⇒ 0 creaciones.
