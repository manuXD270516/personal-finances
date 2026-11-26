---
id: TC-CLASSIFICATION-MERGE-005
title: "Fusionar una categoría en sí misma se rechaza con VALIDATION_FAILED"
spec: classification/categories
related_specs: []
requirement: "Fusionar categorías"
scenario: "Origen igual a la destino"
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
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace \"W1\" en BOB con \"Supermercado\"; usuario EDITOR"
input: {}
steps:
  - "se intenta fusionar \"Supermercado\" en \"Supermercado\""
expected_result:
  - "se rechaza con VALIDATION_FAILED sin cambios"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-005 — Fusionar una categoría en sí misma se rechaza con VALIDATION_FAILED

## Intención

Verifica el scenario "Origen igual a la destino" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con "Supermercado"; usuario EDITOR
Cuando se intenta fusionar "Supermercado" en "Supermercado"
Entonces se rechaza con VALIDATION_FAILED sin cambios
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
