---
id: TC-PLANNING-HISTBUDGET-023
title: "El plan creado desde el template predeterminado no usa el historial"
spec: planning/budgets
related_specs: ["planning/budget-templates","planning/financial-periods"]
requirement: "Sin aplicación automática de sugerencias históricas"
scenario: "Periodo nuevo desde el template predeterminado"
requirement_status: confirmed
fr: ["FR-PLANNING-021","FR-PLANNING-014"]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
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
  - "\"Mes estándar\" predeterminado con \"Supermercado\" máximo 1600.00 BOB"
  - "Promedio histórico de \"Supermercado\" 1480.00 BOB"
input: {}
steps:
  - "Crear automáticamente el periodo 2027-01"
expected_result:
  - "\"Supermercado\" con 1600.00 BOB y sin historyBasis"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-023 — El plan creado desde el template predeterminado no usa el historial

## Intención

Nunca automático.

## Escenario

```gherkin
Dado un template predeterminado
Cuando se crea un periodo
Entonces su plan no usa sugerencias históricas
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
