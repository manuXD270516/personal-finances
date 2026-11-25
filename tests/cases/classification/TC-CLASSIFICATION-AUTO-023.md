---
id: TC-CLASSIFICATION-AUTO-023
title: "El historial de otro workspace no influye en las sugerencias"
spec: classification/auto-classification
related_specs: []
requirement: "Permisos y aislamiento de las sugerencias"
scenario: "Historial de otro workspace"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003","NFR-SEC-004"]
invariants: []
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/category-suggestions.api.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["category-suggestions","rls"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "\"W2\" tiene 10 gastos \"PEDIDOSYA\" en \"Delivery\" y \"W1\" no tiene historial para ese patrón"
  - "el OWNER de \"W1\" pide la sugerencia para \"PEDIDOSYA\", también con la caché de \"W2\" cargada"
expected_result:
  - "la respuesta de \"W1\" es NONE"
  - "rules.category_suggestion_outcome tiene RLS forzada y está registrada en platform.workspace_scoped_table"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-023 — El historial de otro workspace no influye en las sugerencias

## Intención

Verifica el scenario "Historial de otro workspace" del requirement "Permisos y aislamiento de las sugerencias" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-IDENTITY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando "W2" tiene 10 gastos "PEDIDOSYA" en "Delivery" y "W1" no tiene historial para ese patrón
Y el OWNER de "W1" pide la sugerencia para "PEDIDOSYA", también con la caché de "W2" cargada
Entonces la respuesta de "W1" es NONE
Y rules.category_suggestion_outcome tiene RLS forzada y está registrada en platform.workspace_scoped_table
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
