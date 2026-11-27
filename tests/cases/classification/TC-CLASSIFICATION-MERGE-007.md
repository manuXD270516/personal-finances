---
id: TC-CLASSIFICATION-MERGE-007
title: "Repetir la fusión con la misma clave de idempotencia no reasigna dos veces"
spec: classification/categories
related_specs: ["platform/api-conventions"]
requirement: "Fusionar categorías"
scenario: "Repetir la misma fusión"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-007"]
nfr: []
invariants: ["INV-019"]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","categories","idempotency"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; \"Super\" ya se fusionó en \"Supermercado\" con la clave de idempotencia K1"
input: {}
steps:
  - "se repite la misma petición con la clave K1"
expected_result:
  - "responde el mismo resultado guardado"
  - "\"Supermercado\" sigue sumando 1560.50 BOB en noviembre de 2026 y no hay registros de auditoría nuevos"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-007 — Repetir la fusión con la misma clave de idempotencia no reasigna dos veces

## Intención

Verifica el scenario "Repetir la misma fusión" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Super" ya se fusionó en "Supermercado" con la clave de idempotencia K1
Cuando se repite la misma petición con la clave K1
Entonces responde el mismo resultado guardado
Y "Supermercado" sigue sumando 1560.50 BOB en noviembre de 2026 y no hay registros de auditoría nuevos
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
