---
id: TC-CLASSIFICATION-MERGE-008
title: "Vista previa con porciones abiertas y cerradas, plan y regla sin cambios"
spec: classification/categories
related_specs: ["planning/budgets"]
requirement: "Vista previa de la fusión de categorías"
scenario: "Vista previa sin conflictos"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories","preview"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; octubre de 2026 cerrado y noviembre abierto"
  - "\"Super\" con 3 porciones en noviembre, 2 en octubre, 1 línea en el plan de noviembre y 1 regla"
input: {}
steps:
  - "se pide la vista previa de la fusión de \"Super\" en \"Supermercado\""
expected_result:
  - "counts: SPLITS_OPEN 3, SPLITS_CLOSED_KEPT 2, BUDGET_LINES 1, RULES 1; conflicts vacío"
  - "ninguna porción, línea ni regla cambia"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-008 — Vista previa con porciones abiertas y cerradas, plan y regla sin cambios

## Intención

Verifica el scenario "Vista previa sin conflictos" del requirement "Vista previa de la fusión de categorías" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; octubre de 2026 cerrado y noviembre abierto
Y "Super" con 3 porciones en noviembre, 2 en octubre, 1 línea en el plan de noviembre y 1 regla
Cuando se pide la vista previa de la fusión de "Super" en "Supermercado"
Entonces counts: SPLITS_OPEN 3, SPLITS_CLOSED_KEPT 2, BUDGET_LINES 1, RULES 1; conflicts vacío
Y ninguna porción, línea ni regla cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
