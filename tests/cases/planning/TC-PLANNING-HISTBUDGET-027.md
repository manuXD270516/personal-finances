---
id: TC-PLANNING-HISTBUDGET-027
title: "Confirmar sugerencias en un periodo cerrado se rechaza"
spec: planning/budgets
related_specs: []
requirement: "Permisos, periodos cerrados y auditoría de las sugerencias"
scenario: "Periodo cerrado"
requirement_status: confirmed
fr: ["FR-PLANNING-005","FR-PLANNING-021"]
nfr: []
invariants: ["INV-015"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/budget-suggestions.api.test.ts
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["planning","budgets","historical-budgets"]
error_code: PERIOD_CLOSED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
  - "Periodo \"2026-10\" cerrado con plan"
input: {}
steps:
  - "Confirmar sugerencias para 2026-10"
expected_result:
  - "409 PERIOD_CLOSED"
  - "El plan conserva sus montos"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-027 — Confirmar sugerencias en un periodo cerrado se rechaza

## Intención

Los periodos cerrados no cambian en silencio.

## Escenario

```gherkin
Dado octubre cerrado
Cuando confirmo sugerencias
Entonces se rechaza con PERIOD_CLOSED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
