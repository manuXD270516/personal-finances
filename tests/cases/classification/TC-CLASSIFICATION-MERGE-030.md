---
id: TC-CLASSIFICATION-MERGE-030
title: "La sugerencia de categoría propone la destino y nunca la origen fusionada"
spec: classification/categories
related_specs: ["classification/auto-classification"]
requirement: "Continuidad de la historia de una categoría fusionada en los análisis"
scenario: "Sugerencia con la evidencia de la origen"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007", "FR-CLASSIFICATION-014"]
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge", "categories", "suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; gastos con la descripción \"HIPERMAXI\" clasificados en \"Super\" en periodos cerrados"
input: {}
steps:
  - "el EDITOR fusiona \"Super\" en \"Supermercado\""
  - "el EDITOR registra un gasto con la descripción \"HIPERMAXI\""
expected_result:
  - "la sugerencia de categoría es \"Supermercado\""
  - "ninguna sugerencia propone \"Super\""
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-030 — La sugerencia de categoría propone la destino y nunca la origen fusionada

## Intención

Verifica el scenario "Sugerencia con la evidencia de la origen" del requirement "Continuidad de la historia de una categoría fusionada en los análisis" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; gastos con la descripción "HIPERMAXI" clasificados en "Super" en periodos cerrados
Cuando el EDITOR fusiona "Super" en "Supermercado"
Y el EDITOR registra un gasto con la descripción "HIPERMAXI"
Entonces la sugerencia de categoría es "Supermercado"
Y ninguna sugerencia propone "Super"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9), D496, tarea 3.9. Datos ficticios; ningún dato real del owner.
