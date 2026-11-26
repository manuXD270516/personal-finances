---
id: TC-CLASSIFICATION-AUTO-001
title: "Nueve de diez sugiere la categoría con confianza alta"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencia de categoría por historial"
scenario: "Nueve de diez"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014"]
nfr: []
invariants: ["INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/category-suggester.test.ts
  - packages/contexts/rules/src/application/category-suggestions.test.ts
  - apps/api/test/api/category-suggestions.api.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "hay 10 gastos \"PEDIDOSYA\" clasificados por el usuario, 9 en \"Restaurantes\" y 1 en \"Supermercado\""
  - "se pide la sugerencia para un gasto nuevo \"PEDIDOSYA *8812\""
expected_result:
  - "se sugiere \"Restaurantes\" con confianza 0.9000, nivel HIGH, support 10 y matches 9"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-001 — Nueve de diez sugiere la categoría con confianza alta

## Intención

Verifica el scenario "Nueve de diez" del requirement "Sugerencia de categoría por historial" de `classification/auto-classification` (FR-CLASSIFICATION-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando hay 10 gastos "PEDIDOSYA" clasificados por el usuario, 9 en "Restaurantes" y 1 en "Supermercado"
Y se pide la sugerencia para un gasto nuevo "PEDIDOSYA *8812"
Entonces se sugiere "Restaurantes" con confianza 0.9000, nivel HIGH, support 10 y matches 9
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
