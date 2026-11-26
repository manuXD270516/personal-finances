---
id: TC-CLASSIFICATION-AUTO-006
title: "Una categoría archivada no se sugiere"
spec: classification/auto-classification
related_specs: []
requirement: "Historial que cuenta para la sugerencia"
scenario: "Categoría archivada"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014","FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/category-suggestions.test.ts
  - apps/api/test/api/category-suggestions.api.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "los 5 gastos del patrón \"GIMNASIO BODYTECH\" están en \"Gimnasio\" y \"Gimnasio\" se archivó"
  - "se pide la sugerencia para \"GIMNASIO BODYTECH\""
expected_result:
  - "no se sugiere \"Gimnasio\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-006 — Una categoría archivada no se sugiere

## Intención

Verifica el scenario "Categoría archivada" del requirement "Historial que cuenta para la sugerencia" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-RULES-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando los 5 gastos del patrón "GIMNASIO BODYTECH" están en "Gimnasio" y "Gimnasio" se archivó
Y se pide la sugerencia para "GIMNASIO BODYTECH"
Entonces no se sugiere "Gimnasio"
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
