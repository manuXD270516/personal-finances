---
id: TC-IMPORTS-PIPELINE-008
title: "Una interrupción del procesamiento se reanuda sin duplicar filas del staging"
spec: imports/import-pipeline
related_specs: []
requirement: "Etapas del import en el worker, reanudables"
scenario: "Interrupción durante el procesamiento"
requirement_status: provisional
fr: ["FR-IMPORTS-001", "FR-IMPORTS-002"]
nfr: []
invariants: []
priority: critical
type: integration
level: database-integration
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
input: "Datos del scenario \"Interrupción durante el procesamiento\" del delta de add-import-pipeline"
steps:
  - "el procesamiento se interrumpe después de leer 2000 de 3000 filas y se reanuda"
expected_result:
  - "la importación llega a \"en revisión\" con exactamente 3000 filas, una por línea del archivo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-008 — Una interrupción del procesamiento se reanuda sin duplicar filas del staging

## Intención

El procesamiento de una importación creada desde un documento DEBE (MUST) correr fuera de la petición, en etapas —lectura, normalización, validación, clasificación, duplicados y coincidencias con compromisos— y DEBE (MUST) informar el estado ("subida", "procesando" con la etapa y las filas procesadas, "esperando mapeo", "en revisión" o "falló la lectura").

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el procesamiento se interrumpe después de leer 2000 de 3000 filas y se reanuda
Entonces la importación llega a "en revisión" con exactamente 3000 filas, una por línea del archivo
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
