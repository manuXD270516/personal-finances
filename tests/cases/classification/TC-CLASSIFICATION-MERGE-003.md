---
id: TC-CLASSIFICATION-MERGE-003
title: "Una categoría de sistema no puede ser origen de una fusión"
spec: classification/categories
related_specs: []
requirement: "Fusionar categorías"
scenario: "Origen de sistema"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-CLASSIFICATION-003"]
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
tags: ["merge","categories","system-categories"]
error_code: "SYSTEM_CATEGORY_IMMUTABLE"
preconditions:
  - "Workspace \"W1\" en BOB con la categoría de sistema \"Comisiones\" y la de gasto \"Gastos bancarios\"; usuario EDITOR"
input: {}
steps:
  - "se intenta fusionar \"Comisiones\" en \"Gastos bancarios\""
expected_result:
  - "se rechaza con SYSTEM_CATEGORY_IMMUTABLE"
  - "\"Comisiones\" sigue ACTIVE"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-003 — Una categoría de sistema no puede ser origen de una fusión

## Intención

Verifica el scenario "Origen de sistema" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-003).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con la categoría de sistema "Comisiones" y la de gasto "Gastos bancarios"; usuario EDITOR
Cuando se intenta fusionar "Comisiones" en "Gastos bancarios"
Entonces se rechaza con SYSTEM_CATEGORY_IMMUTABLE
Y "Comisiones" sigue ACTIVE
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
