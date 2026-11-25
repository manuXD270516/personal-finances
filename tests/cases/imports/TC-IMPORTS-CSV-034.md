---
id: TC-IMPORTS-CSV-034
title: "Al retomar una importación esperando mapeo vuelve el mapeo sugerido de la importación anterior"
spec: imports/import-pipeline
related_specs: []
requirement: "Mapeo sugerido al retomar una importación"
scenario: "Retomar con el mapeo de la importación anterior"
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
tags: ["imports", "csv", "mapping", "resume"]
error_code: null
preconditions:
  - "Workspace con \"Banco BOB\"; una importación anterior aprobada con \"Fecha\", \"Descripción\" y \"Monto\" mapeadas a fecha, descripción y monto"
  - "Una importación nueva de \"Banco BOB\" en AWAITING_MAPPING"
input: {}
steps:
  - "el EDITOR consulta la importación nueva (GET /imports/{id})"
expected_result:
  - "la respuesta trae suggestedMapping igual al mapeo de la importación anterior"
  - "la pantalla de mapeo lo muestra precargado al retomar"
created: 2026-11-25
updated: 2026-11-25
---

# TC-IMPORTS-CSV-034 — Al retomar una importación esperando mapeo vuelve el mapeo sugerido de la importación anterior

## Intención

Verifica el scenario "Retomar con el mapeo de la importación anterior" del requirement "Mapeo sugerido al retomar una importación" de `imports/import-pipeline` (FR-IMPORTS-003).

## Escenario

```gherkin
Dado Workspace con "Banco BOB"; una importación anterior aprobada con "Fecha", "Descripción" y "Monto" mapeadas a fecha, descripción y monto
Y Una importación nueva de "Banco BOB" en AWAITING_MAPPING
Cuando el EDITOR consulta la importación nueva (GET /imports/{id})
Entonces la respuesta trae suggestedMapping igual al mapeo de la importación anterior
Y la pantalla de mapeo lo muestra precargado al retomar
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9), D492 (Could, tarea 6.5). Datos ficticios; ningún dato real del owner.
