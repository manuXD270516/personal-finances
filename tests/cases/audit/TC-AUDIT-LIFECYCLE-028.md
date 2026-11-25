---
id: TC-AUDIT-LIFECYCLE-028
title: "Recorrido de Super fusionada y anotación en Supermercado"
spec: audit/lifecycle-timeline
related_specs: ["classification/categories"]
requirement: "Fusión en el recorrido de categorías y contrapartes"
scenario: "Recorrido de una categoría fusionada"
requirement_status: provisional
fr: ["FR-AUDIT-009","FR-AUDIT-010","FR-CLASSIFICATION-007"]
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
tags: ["lifecycle","merge","categories"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; usuario EDITOR"
input: {}
steps:
  - "se crea la categoría de gasto \"Super\", se registran 3 gastos en ella y se fusiona en \"Supermercado\""
  - "se consultan los recorridos de \"Super\" y de \"Supermercado\""
expected_result:
  - "el de \"Super\" tiene CREATE (a ACTIVE) y MERGE (ACTIVE a ARCHIVED) con la destino \"Supermercado\"; estado actual ARCHIVED"
  - "el de \"Supermercado\" tiene la anotación MERGED_FROM con \"Super\" y 3 porciones, con el mismo operationId"
created: 2026-11-25
updated: 2026-11-25
---

# TC-AUDIT-LIFECYCLE-028 — Recorrido de Super fusionada y anotación en Supermercado

## Intención

Verifica el scenario "Recorrido de una categoría fusionada" del requirement "Fusión en el recorrido de categorías y contrapartes" de `audit/lifecycle-timeline` (FR-AUDIT-009, FR-AUDIT-010, FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; usuario EDITOR
Cuando se crea la categoría de gasto "Super", se registran 3 gastos en ella y se fusiona en "Supermercado"
Y se consultan los recorridos de "Super" y de "Supermercado"
Entonces el de "Super" tiene CREATE (a ACTIVE) y MERGE (ACTIVE a ARCHIVED) con la destino "Supermercado"; estado actual ARCHIVED
Y el de "Supermercado" tiene la anotación MERGED_FROM con "Super" y 3 porciones, con el mismo operationId
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
