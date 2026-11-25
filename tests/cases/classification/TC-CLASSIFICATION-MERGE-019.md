---
id: TC-CLASSIFICATION-MERGE-019
title: "Desarchivar una categoría fusionada se rechaza con CATEGORY_MERGED"
spec: classification/categories
related_specs: []
requirement: "Una categoría fusionada no se desarchiva ni se vuelve a fusionar"
scenario: "Desarchivar una categoría fusionada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-CLASSIFICATION-002"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories"]
error_code: "CATEGORY_MERGED"
preconditions:
  - "Workspace \"W1\" en BOB; \"Super\" fusionada en \"Supermercado\"; usuario EDITOR"
input: {}
steps:
  - "se intenta desarchivar \"Super\""
expected_result:
  - "responde 409 CATEGORY_MERGED indicando \"Supermercado\""
  - "\"Super\" sigue ARCHIVED"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-019 — Desarchivar una categoría fusionada se rechaza con CATEGORY_MERGED

## Intención

Verifica el scenario "Desarchivar una categoría fusionada" del requirement "Una categoría fusionada no se desarchiva ni se vuelve a fusionar" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-002).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Super" fusionada en "Supermercado"; usuario EDITOR
Cuando se intenta desarchivar "Super"
Entonces responde 409 CATEGORY_MERGED indicando "Supermercado"
Y "Super" sigue ARCHIVED
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
