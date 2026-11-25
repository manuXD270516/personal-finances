---
id: TC-CLASSIFICATION-AUTO-008
title: "Dos patrones que coinciden dan una sola sugerencia con la confianza mayor"
spec: classification/auto-classification
related_specs: []
requirement: "Patrones por contraparte y por descripción"
scenario: "Los dos patrones coinciden"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-014","FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
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
  - "el patrón de descripción sugiere \"Restaurantes\" con 0.8000 y el de contraparte con 0.9000"
expected_result:
  - "se devuelve una sola sugerencia de \"Restaurantes\" con confianza 0.9000 y base BOTH"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-008 — Dos patrones que coinciden dan una sola sugerencia con la confianza mayor

## Intención

Verifica el scenario "Los dos patrones coinciden" del requirement "Patrones por contraparte y por descripción" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-RULES-011).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el patrón de descripción sugiere "Restaurantes" con 0.8000 y el de contraparte con 0.9000
Entonces se devuelve una sola sugerencia de "Restaurantes" con confianza 0.9000 y base BOTH
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
