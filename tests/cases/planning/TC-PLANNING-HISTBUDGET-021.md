---
id: TC-PLANNING-HISTBUDGET-021
title: "Monto escrito negativo rechaza toda la confirmación"
spec: planning/budgets
related_specs: []
requirement: "Aplicación revisable con confirmación explícita"
scenario: "Monto escrito inválido"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/budget-suggestions.api.test.ts
  - apps/web/src/ui/planning/suggestions.test.tsx
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["planning","budgets","historical-budgets"]
error_code: BUDGET_INVALID_AMOUNTS
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
input: {"lines":[{"target":"Restaurantes","amount":"-10.00"}]}
steps:
  - "Confirmar \"Restaurantes\" con −10.00 BOB junto con \"Supermercado\""
expected_result:
  - "422 BUDGET_INVALID_AMOUNTS"
  - "Ninguna línea cambia"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-021 — Monto escrito negativo rechaza toda la confirmación

## Intención

La confirmación es atómica y usa las validaciones de línea existentes.

## Escenario

```gherkin
Dado un monto negativo
Cuando confirmo
Entonces se rechaza todo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
