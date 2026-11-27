---
id: TC-IMPORTS-CSV-031
title: "Retomar el mapeo devuelve y muestra las 4 filas de muestra"
spec: imports/import-pipeline
related_specs: []
requirement: "Filas de muestra al retomar una importación esperando mapeo"
scenario: "Retomar el mapeo de un extracto"
requirement_status: confirmed
fr: ["FR-IMPORTS-003","FR-IMPORTS-001"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - apps/web/src/ui/imports/imports.test.tsx
  - packages/contexts/imports/src/application/imports.service.test.ts
  - tests/e2e/specs/csv-import.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["imports","csv","mapping"]
error_code: null
preconditions:
  - "Workspace en BOB con la cuenta activa \"Banco BOB\"; usuario EDITOR"
  - "Se subió \"extracto-octubre.csv\" (windows-1252, punto y coma) con el encabezado \"Fecha;Descripción;Monto\" y 4 filas de datos ficticias; la importación quedó en AWAITING_MAPPING"
input: {}
steps:
  - "se consulta la importación con getImport"
  - "se reabre el asistente de importación en el paso de mapeo"
expected_result:
  - "la respuesta trae el header \"Fecha\", \"Descripción\", \"Monto\" y sampleRows con las 4 filas, iguales a las de la creación"
  - "la pantalla de mapeo muestra las 4 filas escapadas y no muestra el aviso mapping-no-sample"
created: 2026-11-25
updated: 2026-11-26
---

# TC-IMPORTS-CSV-031 — Retomar el mapeo devuelve y muestra las 4 filas de muestra

## Intención

Verifica el scenario "Retomar el mapeo de un extracto" del requirement "Filas de muestra al retomar una importación esperando mapeo" de `imports/import-pipeline` (FR-IMPORTS-003, FR-IMPORTS-001).

## Escenario

```gherkin
Dado Workspace en BOB con la cuenta activa "Banco BOB"; usuario EDITOR
Y Se subió "extracto-octubre.csv" (windows-1252, punto y coma) con el encabezado "Fecha;Descripción;Monto" y 4 filas de datos ficticias; la importación quedó en AWAITING_MAPPING
Cuando se consulta la importación con getImport
Y se reabre el asistente de importación en el paso de mapeo
Entonces la respuesta trae el header "Fecha", "Descripción", "Monto" y sampleRows con las 4 filas, iguales a las de la creación
Y la pantalla de mapeo muestra las 4 filas escapadas y no muestra el aviso mapping-no-sample
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
