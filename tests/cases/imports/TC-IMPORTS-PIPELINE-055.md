---
id: TC-IMPORTS-PIPELINE-055
title: "Tres meses en CSV y OFX con 12 movimientos solapados dejan 115 transacciones sin duplicados"
spec: imports/import-pipeline
related_specs: []
requirement: "Extractos solapados de varios formatos sin duplicados"
scenario: "Tres meses con solapamiento entre CSV y OFX"
requirement_status: provisional
fr: ["FR-IMPORTS-007", "FR-IMPORTS-010", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: integration
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/imports/src/infrastructure/readers/ofx-reader.test.ts
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
input: "Datos del scenario \"Tres meses con solapamiento entre CSV y OFX\" del delta de add-import-pipeline"
steps:
  - "se importó \"enero-15feb.csv\" con 52 movimientos del 2026-01-01 al 2026-02-15 y luego se importa \"feb-mar.ofx\" con 75 movimientos del 2026-02-01 al 2026-03-31, 12 de ellos los mismos del 1 al 15 de febrero con otra descripción"
expected_result:
  - "esas 12 filas son posibles duplicados con su transacción del CSV como candidato"
  - "al omitirlas vinculándolas y aprobar se crean 63 transacciones y la cuenta tiene 115 transacciones importadas, ninguna duplicada"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-055 — Tres meses en CSV y OFX con 12 movimientos solapados dejan 115 transacciones sin duplicados

## Intención

Importar extractos de una misma cuenta en formatos distintos y con periodos que se solapan DEBE (MUST) dejar exactamente una transacción por movimiento real cuando el usuario resuelve los posibles duplicados que el sistema le muestra, y volver a importar cualquiera de esos archivos DEBE (MUST) crear 0 transacciones.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando se importó "enero-15feb.csv" con 52 movimientos del 2026-01-01 al 2026-02-15 y luego se importa "feb-mar.ofx" con 75 movimientos del 2026-02-01 al 2026-03-31, 12 de ellos los mismos del 1 al 15 de febrero con otra descripción
Entonces esas 12 filas son posibles duplicados con su transacción del CSV como candidato
  Y al omitirlas vinculándolas y aprobar se crean 63 transacciones y la cuenta tiene 115 transacciones importadas, ninguna duplicada
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
- Versión sintética del criterio de salida de Phase 6 (docs/24 §5.6). La verificación con los extractos reales del owner es manual y fuera del repositorio (pregunta 1 de design.md).
