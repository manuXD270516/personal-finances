---
id: TC-IMPORTS-PIPELINE-021
title: "Un monto JSON escrito como número hace fallar la lectura con la ubicación del error"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura del formato JSON propio versionado"
scenario: "Monto escrito como número"
requirement_status: provisional
fr: ["FR-IMPORTS-004", "FR-IMPORTS-006"]
nfr: []
invariants: ["INV-001"]
priority: high
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_PARSE_FAILED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Monto escrito como número\" del delta de add-import-pipeline"
steps:
  - "el segundo movimiento de un JSON trae el monto 18.5 como número y no como texto"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PARSE_FAILED` en la ubicación del monto del segundo movimiento"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-021 — Un monto JSON escrito como número hace fallar la lectura con la ubicación del error

## Intención

El sistema DEBE (MUST) importar archivos JSON que declaren el esquema propio versionado de archivo de importación y validarlos contra ese esquema antes de normalizar; los montos DEBEN (MUST) venir como texto decimal, y un archivo que no cumple el esquema DEBE (MUST) dejar la importación en "falló la lectura" con `IMPORT_PARSE_FAILED` y la ubicación del primer error.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el segundo movimiento de un JSON trae el monto 18.5 como número y no como texto
Entonces la importación queda en "falló la lectura" con `IMPORT_PARSE_FAILED` en la ubicación del monto del segundo movimiento
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
