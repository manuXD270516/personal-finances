---
id: TC-CLASSIFICATION-AUTO-011
title: "Aprobar sin aceptar las sugerencias crea las transacciones sin categoría"
spec: classification/auto-classification
related_specs: []
requirement: "Ninguna sugerencia se aplica sin confirmación"
scenario: "Aprobar un import sin aceptar las sugerencias"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: critical
type: integration
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "la vista previa tiene 25 filas con sugerencia no aceptada"
  - "el EDITOR aprueba la importación"
expected_result:
  - "las 25 transacciones se crean «sin categoría»"
  - "se registran 25 resultados IGNORED con canal IMPORT"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-011 — Aprobar sin aceptar las sugerencias crea las transacciones sin categoría

## Intención

Verifica el scenario "Aprobar un import sin aceptar las sugerencias" del requirement "Ninguna sugerencia se aplica sin confirmación" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando la vista previa tiene 25 filas con sugerencia no aceptada
Y el EDITOR aprueba la importación
Entonces las 25 transacciones se crean «sin categoría»
Y se registran 25 resultados IGNORED con canal IMPORT
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
