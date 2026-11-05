---
id: TC-PLANNING-HISTBUDGET-005
title: "Periodo que contiene la primera actividad excluido como incompleto"
spec: planning/budgets
related_specs: ["planning/financial-periods"]
requirement: "Exclusión de periodos incompletos"
scenario: "Primera actividad a mitad de un periodo"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/budget-suggestions.api.test.ts
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
  - packages/contexts/planning/src/domain/suggestion-window.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["planning","budgets","historical-budgets"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
  - "Primera actividad del workspace el 2026-08-20"
  - "Real de \"Restaurantes\": 210.00 BOB (2026-08), 610.00 BOB (2026-09), 650.00 BOB (2026-10)"
input: {"periodo":"2026-11","N":3}
steps:
  - "Pedir la sugerencia de \"Restaurantes\" con N = 3"
expected_result:
  - "2026-08 con estado INCOMPLETE"
  - "Sugerencia 630.00 BOB (1260.00 ÷ 2)"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-005 — Periodo que contiene la primera actividad excluido como incompleto

## Intención

Un mes parcial subestima el gasto; no se cuenta como cero.

## Escenario

```gherkin
Dada la primera actividad el 2026-08-20
Cuando pido la sugerencia con N = 3
Entonces agosto queda incompleto y la sugerencia es 630.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
