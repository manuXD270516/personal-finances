---
id: TC-CLASSIFICATION-MERGE-004
title: "Una destino archivada rechaza la fusión con CATEGORY_ARCHIVED"
spec: classification/categories
related_specs: []
requirement: "Fusionar categorías"
scenario: "Destino archivada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007"]
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
tags: ["merge","categories"]
error_code: "CATEGORY_ARCHIVED"
preconditions:
  - "Workspace \"W1\" en BOB con \"Super\" activa con porciones y \"Old Market\" archivada; usuario EDITOR"
input: {}
steps:
  - "se intenta fusionar \"Super\" en \"Old Market\""
expected_result:
  - "se rechaza con CATEGORY_ARCHIVED"
  - "\"Super\" sigue con sus porciones"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-004 — Una destino archivada rechaza la fusión con CATEGORY_ARCHIVED

## Intención

Verifica el scenario "Destino archivada" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con "Super" activa con porciones y "Old Market" archivada; usuario EDITOR
Cuando se intenta fusionar "Super" en "Old Market"
Entonces se rechaza con CATEGORY_ARCHIVED
Y "Super" sigue con sus porciones
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
