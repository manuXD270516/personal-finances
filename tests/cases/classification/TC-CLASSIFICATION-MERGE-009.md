---
id: TC-CLASSIFICATION-MERGE-009
title: "Plan con líneas de las dos categorías bloquea la fusión con CLASSIFICATION_MERGE_CONFLICT"
spec: classification/categories
related_specs: ["planning/budgets"]
requirement: "Vista previa de la fusión de categorías"
scenario: "Plan con líneas de las dos categorías"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-PLANNING-008"]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories","budgets"]
error_code: "CLASSIFICATION_MERGE_CONFLICT"
preconditions:
  - "Workspace \"W1\" en BOB; plan de noviembre de 2026 con las líneas \"Super\" (máximo 400.00 BOB) y \"Supermercado\" (máximo 1500.00 BOB); usuario EDITOR"
input: {}
steps:
  - "se pide la vista previa y luego se fusiona \"Super\" en \"Supermercado\""
expected_result:
  - "la vista previa lista el conflicto BUDGET_LINE_EXISTS del plan de noviembre de 2026"
  - "la fusión responde 409 CLASSIFICATION_MERGE_CONFLICT con ese conflicto en los detalles"
  - "las dos líneas, las porciones y \"Super\" quedan como estaban"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-009 — Plan con líneas de las dos categorías bloquea la fusión con CLASSIFICATION_MERGE_CONFLICT

## Intención

Verifica el scenario "Plan con líneas de las dos categorías" del requirement "Vista previa de la fusión de categorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-PLANNING-008).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; plan de noviembre de 2026 con las líneas "Super" (máximo 400.00 BOB) y "Supermercado" (máximo 1500.00 BOB); usuario EDITOR
Cuando se pide la vista previa y luego se fusiona "Super" en "Supermercado"
Entonces la vista previa lista el conflicto BUDGET_LINE_EXISTS del plan de noviembre de 2026
Y la fusión responde 409 CLASSIFICATION_MERGE_CONFLICT con ese conflicto en los detalles
Y las dos líneas, las porciones y "Super" quedan como estaban
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
