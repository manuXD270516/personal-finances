---
id: TC-CLASSIFICATION-AUTO-005
title: "Las categorías fijadas por reglas no cuentan como historial"
spec: classification/auto-classification
related_specs: []
requirement: "Historial que cuenta para la sugerencia"
scenario: "Clasificaciones hechas por una regla no cuentan"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014","FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
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
  - "6 gastos \"HIPERMAXI SUC 12\" tienen la categoría \"Supermercado\" fijada por una regla hoy desactivada"
  - "se pide la sugerencia para \"HIPERMAXI SUC 12\""
expected_result:
  - "la respuesta es NONE: esos gastos no cuentan como historial"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-005 — Las categorías fijadas por reglas no cuentan como historial

## Intención

Verifica el scenario "Clasificaciones hechas por una regla no cuentan" del requirement "Historial que cuenta para la sugerencia" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-RULES-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando 6 gastos "HIPERMAXI SUC 12" tienen la categoría "Supermercado" fijada por una regla hoy desactivada
Y se pide la sugerencia para "HIPERMAXI SUC 12"
Entonces la respuesta es NONE: esos gastos no cuentan como historial
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
