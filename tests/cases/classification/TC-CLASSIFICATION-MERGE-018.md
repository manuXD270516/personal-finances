---
id: TC-CLASSIFICATION-MERGE-018
title: "La fila de una importación en revisión pasa a la destino y se aprueba en ella"
spec: classification/categories
related_specs: ["imports/import-pipeline"]
requirement: "Referencias a la categoría fusionada en otros contextos"
scenario: "Importación en revisión"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007","FR-IMPORTS-003"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","categories","imports"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; importación de \"Banco BOB\" en AWAITING_REVIEW con una fila de 85.50 BOB clasificada en \"Super\"; usuario EDITOR"
input: {}
steps:
  - "se fusiona \"Super\" en \"Supermercado\""
  - "se aprueba la importación"
expected_result:
  - "la fila queda clasificada en \"Supermercado\""
  - "el gasto de 85.50 BOB se registra en \"Supermercado\" sin CATEGORY_ARCHIVED"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-018 — La fila de una importación en revisión pasa a la destino y se aprueba en ella

## Intención

Verifica el scenario "Importación en revisión" del requirement "Referencias a la categoría fusionada en otros contextos" de `classification/categories` (FR-CLASSIFICATION-007, FR-IMPORTS-003).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; importación de "Banco BOB" en AWAITING_REVIEW con una fila de 85.50 BOB clasificada en "Super"; usuario EDITOR
Cuando se fusiona "Super" en "Supermercado"
Y se aprueba la importación
Entonces la fila queda clasificada en "Supermercado"
Y el gasto de 85.50 BOB se registra en "Supermercado" sin CATEGORY_ARCHIVED
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
