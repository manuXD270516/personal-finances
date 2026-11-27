---
id: TC-CLASSIFICATION-MERGE-013
title: "Una subcategoría con nombre repetido en la destino bloquea la fusión"
spec: classification/categories
related_specs: []
requirement: "Fusión de una categoría con subcategorías"
scenario: "Subcategoría con un nombre que ya usa la destino"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007","FR-CLASSIFICATION-001"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
  - packages/contexts/classification/src/application/merge.service.test.ts
  - packages/contexts/classification/src/domain/merge-policy.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","categories","hierarchy"]
error_code: "CLASSIFICATION_MERGE_CONFLICT"
preconditions:
  - "Workspace \"W1\" en BOB; \"Servicios\" y \"Servicios básicos\" tienen cada una la subcategoría activa \"Agua\""
input: {}
steps:
  - "se intenta fusionar \"Servicios\" en \"Servicios básicos\""
expected_result:
  - "se rechaza con CLASSIFICATION_MERGE_CONFLICT con el motivo SUBCATEGORY_NAME_TAKEN para \"Agua\""
  - "nada cambia"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-013 — Una subcategoría con nombre repetido en la destino bloquea la fusión

## Intención

Verifica el scenario "Subcategoría con un nombre que ya usa la destino" del requirement "Fusión de una categoría con subcategorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Servicios" y "Servicios básicos" tienen cada una la subcategoría activa "Agua"
Cuando se intenta fusionar "Servicios" en "Servicios básicos"
Entonces se rechaza con CLASSIFICATION_MERGE_CONFLICT con el motivo SUBCATEGORY_NAME_TAKEN para "Agua"
Y nada cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
