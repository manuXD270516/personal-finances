---
id: TC-IMPORTS-CSV-035
title: "Sin importaciones anteriores de la cuenta la importación esperando mapeo no trae mapeo sugerido"
spec: imports/import-pipeline
related_specs: []
requirement: "Mapeo sugerido al retomar una importación"
scenario: "Cuenta sin importaciones anteriores"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/application/imports.service.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["imports", "csv", "mapping", "resume"]
error_code: null
preconditions:
  - "Workspace con \"Banco USD\" sin importaciones anteriores"
  - "Su primera importación en AWAITING_MAPPING"
input: {}
steps:
  - "el EDITOR consulta la importación (GET /imports/{id})"
expected_result:
  - "la respuesta no trae suggestedMapping"
  - "la pantalla de mapeo empieza vacía"
created: 2026-11-25
updated: 2026-11-26
---

# TC-IMPORTS-CSV-035 — Sin importaciones anteriores de la cuenta la importación esperando mapeo no trae mapeo sugerido

## Intención

Verifica el scenario "Cuenta sin importaciones anteriores" del requirement "Mapeo sugerido al retomar una importación" de `imports/import-pipeline` (FR-IMPORTS-003).

## Escenario

```gherkin
Dado Workspace con "Banco USD" sin importaciones anteriores
Y Su primera importación en AWAITING_MAPPING
Cuando el EDITOR consulta la importación (GET /imports/{id})
Entonces la respuesta no trae suggestedMapping
Y la pantalla de mapeo empieza vacía
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9), D492 (Could, tarea 6.5). Datos ficticios; ningún dato real del owner.
