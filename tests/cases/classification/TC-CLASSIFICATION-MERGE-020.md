---
id: TC-CLASSIFICATION-MERGE-020
title: "Fusionar de nuevo una categoría fusionada se rechaza con CATEGORY_MERGED"
spec: classification/categories
related_specs: []
requirement: "Una categoría fusionada no se desarchiva ni se vuelve a fusionar"
scenario: "Fusionar de nuevo una categoría fusionada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007"]
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
tags: ["merge","categories"]
error_code: "CATEGORY_MERGED"
preconditions:
  - "Workspace \"W1\" en BOB; \"Super\" fusionada en \"Supermercado\"; \"Mercado\" activa"
input: {}
steps:
  - "se intenta fusionar \"Super\" en \"Mercado\""
expected_result:
  - "se rechaza con CATEGORY_MERGED sin cambios"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-020 — Fusionar de nuevo una categoría fusionada se rechaza con CATEGORY_MERGED

## Intención

Verifica el scenario "Fusionar de nuevo una categoría fusionada" del requirement "Una categoría fusionada no se desarchiva ni se vuelve a fusionar" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Super" fusionada en "Supermercado"; "Mercado" activa
Cuando se intenta fusionar "Super" en "Mercado"
Entonces se rechaza con CATEGORY_MERGED sin cambios
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
