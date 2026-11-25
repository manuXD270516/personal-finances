---
id: TC-CLASSIFICATION-AUTO-010
title: "Las filas clasificadas por una regla o por el usuario no muestran sugerencia"
spec: classification/auto-classification
related_specs: []
requirement: "Las reglas y la elección del usuario siempre ganan"
scenario: "Fila del import ya clasificada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014","FR-RULES-009"]
nfr: []
invariants: []
priority: high
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
  - "en la vista previa una regla propuso \"Transporte\" para la fila \"UBER TRIP\" y otra fila tiene la categoría \"Hogar\" elegida por el usuario"
expected_result:
  - "ninguna de las dos filas tiene suggestedCategory"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-010 — Las filas clasificadas por una regla o por el usuario no muestran sugerencia

## Intención

Verifica el scenario "Fila del import ya clasificada" del requirement "Las reglas y la elección del usuario siempre ganan" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-RULES-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando en la vista previa una regla propuso "Transporte" para la fila "UBER TRIP" y otra fila tiene la categoría "Hogar" elegida por el usuario
Entonces ninguna de las dos filas tiene suggestedCategory
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
