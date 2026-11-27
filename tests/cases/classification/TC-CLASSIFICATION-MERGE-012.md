---
id: TC-CLASSIFICATION-MERGE-012
title: "Fusionar una subcategoría en su padre lleva sus 180,00 al padre"
spec: classification/categories
related_specs: []
requirement: "Fusión de una categoría con subcategorías"
scenario: "Subcategoría fusionada en su padre"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007"]
nfr: []
invariants: ["INV-019"]
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
  - packages/contexts/classification/src/domain/merge-policy.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","categories","hierarchy"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; \"Luz\" subcategoría de \"Servicios básicos\" con gastos de noviembre de 2026 que suman 180.00 BOB"
input: {}
steps:
  - "se fusiona \"Luz\" en \"Servicios básicos\""
expected_result:
  - "los 180.00 BOB pasan a \"Servicios básicos\""
  - "\"Luz\" queda ARCHIVED con mergedInto \"Servicios básicos\""
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-012 — Fusionar una subcategoría en su padre lleva sus 180,00 al padre

## Intención

Verifica el scenario "Subcategoría fusionada en su padre" del requirement "Fusión de una categoría con subcategorías" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Luz" subcategoría de "Servicios básicos" con gastos de noviembre de 2026 que suman 180.00 BOB
Cuando se fusiona "Luz" en "Servicios básicos"
Entonces los 180.00 BOB pasan a "Servicios básicos"
Y "Luz" queda ARCHIVED con mergedInto "Servicios básicos"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
