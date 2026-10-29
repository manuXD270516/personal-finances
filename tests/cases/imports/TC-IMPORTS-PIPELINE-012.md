---
id: TC-IMPORTS-PIPELINE-012
title: "Un extracto PDF se rechaza con IMPORT_UNSUPPORTED_FORMAT al crear la importación"
spec: imports/import-pipeline
related_specs: []
requirement: "Formatos de archivo detectados por contenido"
scenario: "Documento PDF"
requirement_status: provisional
fr: ["FR-IMPORTS-004"]
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
tags: ["imports", "import-pipeline"]
error_code: IMPORT_UNSUPPORTED_FORMAT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Documento PDF\" del delta de add-import-pipeline"
steps:
  - "un EDITOR crea una importación con un extracto PDF disponible"
expected_result:
  - "se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-012 — Un extracto PDF se rechaza con IMPORT_UNSUPPORTED_FORMAT al crear la importación

## Intención

El sistema DEBE (MUST) importar archivos CSV, OFX (1.x y 2.x), QIF y JSON del esquema propio, eligiendo el lector por el formato detectado en el contenido del documento y no por su nombre; un documento de un formato no importable DEBE (MUST) rechazarse al crear la importación con `IMPORT_UNSUPPORTED_FORMAT`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un EDITOR crea una importación con un extracto PDF disponible
Entonces se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
