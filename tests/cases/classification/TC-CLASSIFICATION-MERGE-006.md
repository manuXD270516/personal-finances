---
id: TC-CLASSIFICATION-MERGE-006
title: "Un VIEWER no puede fusionar categorías"
spec: classification/categories
related_specs: ["security/access-control"]
requirement: "Fusionar categorías"
scenario: "VIEWER no fusiona"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007","FR-IDENTITY-006"]
nfr: []
invariants: []
priority: medium
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","categories","roles"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Workspace \"W1\" en BOB con \"Super\" y \"Supermercado\"; usuario VIEWER"
input: {}
steps:
  - "el VIEWER llama a mergeCategory de \"Super\" en \"Supermercado\""
expected_result:
  - "responde 403 INSUFFICIENT_ROLE"
  - "nada cambia"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-006 — Un VIEWER no puede fusionar categorías

## Intención

Verifica el scenario "VIEWER no fusiona" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-IDENTITY-006).

## Escenario

```gherkin
Dado Workspace "W1" en BOB con "Super" y "Supermercado"; usuario VIEWER
Cuando el VIEWER llama a mergeCategory de "Super" en "Supermercado"
Entonces responde 403 INSUFFICIENT_ROLE
Y nada cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
