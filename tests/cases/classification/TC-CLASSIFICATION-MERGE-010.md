---
id: TC-CLASSIFICATION-MERGE-010
title: "Las subcategorías de la origen pasan a la destino de primer nivel"
spec: classification/categories
related_specs: []
requirement: "Fusión de una categoría con subcategorías"
scenario: "Subcategorías que pasan a la destino"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-CLASSIFICATION-001"]
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
tags: ["merge","categories","hierarchy"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; \"Servicios\" con las subcategorías activas \"Luz\" y \"Agua\"; \"Servicios básicos\" de primer nivel sin subcategorías con esos nombres; gasto de \"Luz\" de 180.00 BOB en noviembre de 2026"
input: {}
steps:
  - "se fusiona \"Servicios\" en \"Servicios básicos\""
expected_result:
  - "\"Luz\" y \"Agua\" son subcategorías de \"Servicios básicos\""
  - "el gasto de 180.00 BOB sigue en \"Luz\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-010 — Las subcategorías de la origen pasan a la destino de primer nivel

## Intención

Verifica el scenario "Subcategorías que pasan a la destino" del requirement "Fusión de una categoría con subcategorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Servicios" con las subcategorías activas "Luz" y "Agua"; "Servicios básicos" de primer nivel sin subcategorías con esos nombres; gasto de "Luz" de 180.00 BOB en noviembre de 2026
Cuando se fusiona "Servicios" en "Servicios básicos"
Entonces "Luz" y "Agua" son subcategorías de "Servicios básicos"
Y el gasto de 180.00 BOB sigue en "Luz"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
