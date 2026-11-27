---
id: TC-IMPORTS-CSV-032
title: "La muestra al retomar se limita a 20 filas"
spec: imports/import-pipeline
related_specs: []
requirement: "Filas de muestra al retomar una importación esperando mapeo"
scenario: "Archivo con más de 20 filas"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/application/imports.service.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["imports","csv","mapping"]
error_code: null
preconditions:
  - "Workspace en BOB con la cuenta activa \"Banco BOB\""
  - "Importación en AWAITING_MAPPING de un CSV ficticio con encabezado y 150 filas de datos"
input: {}
steps:
  - "se consulta la importación"
expected_result:
  - "sampleRows tiene 20 elementos: las filas de datos 1 a 20 en el orden del archivo"
created: 2026-11-25
updated: 2026-11-26
---

# TC-IMPORTS-CSV-032 — La muestra al retomar se limita a 20 filas

## Intención

Verifica el scenario "Archivo con más de 20 filas" del requirement "Filas de muestra al retomar una importación esperando mapeo" de `imports/import-pipeline` (FR-IMPORTS-003).

## Escenario

```gherkin
Dado Workspace en BOB con la cuenta activa "Banco BOB"
Y Importación en AWAITING_MAPPING de un CSV ficticio con encabezado y 150 filas de datos
Cuando se consulta la importación
Entonces sampleRows tiene 20 elementos: las filas de datos 1 a 20 en el orden del archivo
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
