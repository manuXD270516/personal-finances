---
id: TC-CLASSIFICATION-AUTO-024
title: "Un VIEWER no puede aceptar sugerencias en lote"
spec: classification/auto-classification
related_specs: []
requirement: "Permisos y aislamiento de las sugerencias"
scenario: "VIEWER acepta en lote"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["category-suggestions","rbac"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "un VIEWER llama a accept-suggestions de una vista previa"
expected_result:
  - "se rechaza con 403 y ninguna fila cambia"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-024 — Un VIEWER no puede aceptar sugerencias en lote

## Intención

Verifica el scenario "VIEWER acepta en lote" del requirement "Permisos y aislamiento de las sugerencias" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-IDENTITY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando un VIEWER llama a accept-suggestions de una vista previa
Entonces se rechaza con 403 y ninguna fila cambia
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
