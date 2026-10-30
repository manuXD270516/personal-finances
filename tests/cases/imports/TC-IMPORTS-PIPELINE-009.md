---
id: TC-IMPORTS-PIPELINE-009
title: "Un OFX con el bloque de movimientos sin cerrar deja la importación en falló la lectura sin filas"
spec: imports/import-pipeline
related_specs: []
requirement: "Etapas del import en el worker, reanudables"
scenario: "Archivo estructuralmente ilegible"
requirement_status: provisional
fr: ["FR-IMPORTS-001", "FR-IMPORTS-002"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - apps/web/src/ui/imports/pipeline.test.tsx
  - packages/contexts/imports/src/domain/import-job.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.test.ts
  - packages/contexts/imports/test/integration/pg-pipeline.int.test.ts
status: automated
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
input: "Datos del scenario \"Archivo estructuralmente ilegible\" del delta de add-import-pipeline"
steps:
  - "el documento de una importación es un OFX cuyo bloque de movimientos no cierra"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PARSE_FAILED` y la ubicación del error"
  - "no tiene filas"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-009 — Un OFX con el bloque de movimientos sin cerrar deja la importación en falló la lectura sin filas

## Intención

El procesamiento de una importación creada desde un documento DEBE (MUST) correr fuera de la petición, en etapas —lectura, normalización, validación, clasificación, duplicados y coincidencias con compromisos— y DEBE (MUST) informar el estado ("subida", "procesando" con la etapa y las filas procesadas, "esperando mapeo", "en revisión" o "falló la lectura").

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el documento de una importación es un OFX cuyo bloque de movimientos no cierra
Entonces la importación queda en "falló la lectura" con `IMPORT_PARSE_FAILED` y la ubicación del error
  Y no tiene filas
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
