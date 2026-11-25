---
id: TC-CLASSIFICATION-MERGE-017
title: "Categoría por defecto de la contraparte y esenciales sin duplicar"
spec: classification/categories
related_specs: ["classification/counterparties","reporting/dashboard"]
requirement: "Referencias a la categoría fusionada en otros contextos"
scenario: "Contraparte y categorías esenciales"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-PLANNING-024"]
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
tags: ["merge","categories","spendable"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; \"Hipermaxi\" con categoría por defecto \"Super\"; esenciales del disponible: \"Super\" y \"Supermercado\""
input: {}
steps:
  - "se fusiona \"Super\" en \"Supermercado\""
expected_result:
  - "\"Hipermaxi\" tiene \"Supermercado\" como categoría por defecto"
  - "los esenciales del disponible son solo \"Supermercado\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-017 — Categoría por defecto de la contraparte y esenciales sin duplicar

## Intención

Verifica el scenario "Contraparte y categorías esenciales" del requirement "Referencias a la categoría fusionada en otros contextos" de `classification/categories` (FR-CLASSIFICATION-007, FR-PLANNING-024).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Hipermaxi" con categoría por defecto "Super"; esenciales del disponible: "Super" y "Supermercado"
Cuando se fusiona "Super" en "Supermercado"
Entonces "Hipermaxi" tiene "Supermercado" como categoría por defecto
Y los esenciales del disponible son solo "Supermercado"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
