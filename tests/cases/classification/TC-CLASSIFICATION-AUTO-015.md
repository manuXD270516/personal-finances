---
id: TC-CLASSIFICATION-AUTO-015
title: "Aceptar en lote con una versión vencida se rechaza"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia en la vista previa del import"
scenario: "Versión vencida"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014","FR-IMPORTS-009"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: "PRECONDITION_FAILED"
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "otra edición cambió la versión de la importación"
  - "el EDITOR llama a accept-suggestions con la versión anterior"
expected_result:
  - "se rechaza con 412 PRECONDITION_FAILED y ninguna fila cambia"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-015 — Aceptar en lote con una versión vencida se rechaza

## Intención

Verifica el scenario "Versión vencida" del requirement "Sugerencia en la vista previa del import" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-IMPORTS-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando otra edición cambió la versión de la importación
Y el EDITOR llama a accept-suggestions con la versión anterior
Entonces se rechaza con 412 PRECONDITION_FAILED y ninguna fila cambia
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
