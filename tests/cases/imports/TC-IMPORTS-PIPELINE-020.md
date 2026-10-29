---
id: TC-IMPORTS-PIPELINE-020
title: "Un JSON del esquema propio versión 1 con 3 movimientos llega a revisión con 3 filas"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura del formato JSON propio versionado"
scenario: "Archivo JSON válido"
requirement_status: provisional
fr: ["FR-IMPORTS-004", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Archivo JSON válido\" del delta de add-import-pipeline"
steps:
  - "un EDITOR importa un JSON del esquema propio versión 1 con 3 movimientos en BOB"
expected_result:
  - "la importación llega a \"en revisión\" con 3 filas"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-020 — Un JSON del esquema propio versión 1 con 3 movimientos llega a revisión con 3 filas

## Intención

El sistema DEBE (MUST) importar archivos JSON que declaren el esquema propio versionado de archivo de importación y validarlos contra ese esquema antes de normalizar; los montos DEBEN (MUST) venir como texto decimal, y un archivo que no cumple el esquema DEBE (MUST) dejar la importación en "falló la lectura" con `IMPORT_PARSE_FAILED` y la ubicación del primer error.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un EDITOR importa un JSON del esquema propio versión 1 con 3 movimientos en BOB
Entonces la importación llega a "en revisión" con 3 filas
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
