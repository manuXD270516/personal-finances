---
id: TC-CLASSIFICATION-MERGE-015
title: "Un periodo reabierto se reasigna como abierto"
spec: classification/categories
related_specs: ["planning/month-closing"]
requirement: "Fusión de categorías y periodos cerrados"
scenario: "Periodo reabierto"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007"]
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories","closed-periods"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; octubre de 2026 reabierto; \"Super\" con un gasto de 100.00 BOB en octubre"
input: {}
steps:
  - "se fusiona \"Super\" en \"Supermercado\""
expected_result:
  - "el gasto de 100.00 BOB de octubre pasa a \"Supermercado\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-015 — Un periodo reabierto se reasigna como abierto

## Intención

Verifica el scenario "Periodo reabierto" del requirement "Fusión de categorías y periodos cerrados" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; octubre de 2026 reabierto; "Super" con un gasto de 100.00 BOB en octubre
Cuando se fusiona "Super" en "Supermercado"
Entonces el gasto de 100.00 BOB de octubre pasa a "Supermercado"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
