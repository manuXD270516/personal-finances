---
id: TC-CLASSIFICATION-MERGE-002
title: "Fusionar categorías de distinto tipo se rechaza con CATEGORY_KIND_MISMATCH"
spec: classification/categories
related_specs: []
requirement: "Fusionar categorías"
scenario: "Tipos de movimiento distintos"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007"]
nfr: []
invariants: ["INV-019"]
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories"]
error_code: "CATEGORY_KIND_MISMATCH"
preconditions:
  - "Workspace \"W1\" en BOB con la categoría de gasto \"Super\" y la de ingreso \"Sueldo\"; usuario EDITOR"
input: {}
steps:
  - "se intenta fusionar \"Super\" en \"Sueldo\""
expected_result:
  - "se rechaza con CATEGORY_KIND_MISMATCH"
  - "ninguna porción ni categoría cambia"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-002 — Fusionar categorías de distinto tipo se rechaza con CATEGORY_KIND_MISMATCH

## Intención

Verifica el scenario "Tipos de movimiento distintos" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con la categoría de gasto "Super" y la de ingreso "Sueldo"; usuario EDITOR
Cuando se intenta fusionar "Super" en "Sueldo"
Entonces se rechaza con CATEGORY_KIND_MISMATCH
Y ninguna porción ni categoría cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
