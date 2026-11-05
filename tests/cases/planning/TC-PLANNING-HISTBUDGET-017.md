---
id: TC-PLANNING-HISTBUDGET-017
title: "Línea de porcentaje de ingresos sin sugerencia"
spec: planning/budgets
related_specs: []
requirement: "Líneas a las que se aplica la sugerencia"
scenario: "Porcentaje de ingresos no aplica"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["planning","budgets","historical-budgets"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
  - "Plan de 2026-11 con \"Donaciones\" 10 % de los ingresos esperados"
input: {}
steps:
  - "Pedir sugerencias para 2026-11"
expected_result:
  - "\"Donaciones\" con estado NOT_APPLICABLE y suggestedAmount null"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-017 — Línea de porcentaje de ingresos sin sugerencia

## Intención

El monto de esa línea se deriva de los ingresos, no de su historia.

## Escenario

```gherkin
Dada una línea de porcentaje de ingresos
Cuando pido sugerencias
Entonces no aplica
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
