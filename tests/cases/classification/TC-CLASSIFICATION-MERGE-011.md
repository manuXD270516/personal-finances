---
id: TC-CLASSIFICATION-MERGE-011
title: "Una destino subcategoría con origen con hijas se rechaza con CATEGORY_DEPTH_EXCEEDED"
spec: classification/categories
related_specs: []
requirement: "Fusión de una categoría con subcategorías"
scenario: "Destino que es una subcategoría"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-CLASSIFICATION-001"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories","hierarchy"]
error_code: "CATEGORY_DEPTH_EXCEEDED"
preconditions:
  - "Workspace \"W1\" en BOB; \"Servicios\" con la subcategoría activa \"Luz\"; \"Mantenimiento\" es subcategoría de \"Hogar\""
input: {}
steps:
  - "se intenta fusionar \"Servicios\" en \"Mantenimiento\""
expected_result:
  - "se rechaza con CATEGORY_DEPTH_EXCEEDED sin cambios"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-011 — Una destino subcategoría con origen con hijas se rechaza con CATEGORY_DEPTH_EXCEEDED

## Intención

Verifica el scenario "Destino que es una subcategoría" del requirement "Fusión de una categoría con subcategorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Servicios" con la subcategoría activa "Luz"; "Mantenimiento" es subcategoría de "Hogar"
Cuando se intenta fusionar "Servicios" en "Mantenimiento"
Entonces se rechaza con CATEGORY_DEPTH_EXCEEDED sin cambios
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
