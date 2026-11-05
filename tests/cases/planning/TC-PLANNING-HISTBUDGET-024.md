---
id: TC-PLANNING-HISTBUDGET-024
title: "Una línea aplicada no se recalcula cuando cambia la historia"
spec: planning/budgets
related_specs: []
requirement: "Sin aplicación automática de sugerencias históricas"
scenario: "Historia corregida después de aplicar"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
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
  - "\"Supermercado\" de 2026-11 aplicado con 1480.00 BOB desde el historial"
input: {}
steps:
  - "Anular un gasto de 300.00 BOB de 2026-09 en \"Supermercado\""
  - "Consultar el plan"
expected_result:
  - "La línea sigue en 1480.00 BOB"
  - "historyBasis sin cambios"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-024 — Una línea aplicada no se recalcula cuando cambia la historia

## Intención

El monto aprobado no se mueve solo.

## Escenario

```gherkin
Dada una línea aplicada
Cuando se anula un gasto de la ventana
Entonces la línea no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
