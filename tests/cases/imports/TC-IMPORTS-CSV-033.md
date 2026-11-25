---
id: TC-IMPORTS-CSV-033
title: "Una importación ya mapeada no devuelve filas de muestra"
spec: imports/import-pipeline
related_specs: []
requirement: "Filas de muestra al retomar una importación esperando mapeo"
scenario: "Importación ya mapeada"
requirement_status: provisional
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["imports","csv"]
error_code: null
preconditions:
  - "Workspace en BOB con la cuenta activa \"Banco BOB\""
  - "La importación de \"extracto-octubre.csv\" ya tiene mapeo y está en AWAITING_REVIEW"
input: {}
steps:
  - "se consulta la importación"
expected_result:
  - "la respuesta no incluye sampleRows"
  - "el resto de la respuesta es igual a la de antes del change (ImportJob)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-IMPORTS-CSV-033 — Una importación ya mapeada no devuelve filas de muestra

## Intención

Verifica el scenario "Importación ya mapeada" del requirement "Filas de muestra al retomar una importación esperando mapeo" de `imports/import-pipeline` (FR-IMPORTS-003).

## Escenario

```gherkin
Dado Workspace en BOB con la cuenta activa "Banco BOB"
Y La importación de "extracto-octubre.csv" ya tiene mapeo y está en AWAITING_REVIEW
Cuando se consulta la importación
Entonces la respuesta no incluye sampleRows
Y el resto de la respuesta es igual a la de antes del change (ImportJob)
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
