---
id: TC-PLANNING-HISTBUDGET-025
title: "El clonado copia el monto sin la base histórica"
spec: planning/budgets
related_specs: ["planning/budget-templates"]
requirement: "Sin aplicación automática de sugerencias históricas"
scenario: "Clonado sin base histórica"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: high
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
  - "\"Supermercado\" de 2026-11 aplicado con 1480.00 BOB desde el historial"
input: {}
steps:
  - "Crear el plan de 2026-12 clonando 2026-11"
expected_result:
  - "\"Supermercado\" de 2026-12 con 1480.00 BOB, source CLONE y historyBasis null"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-025 — El clonado copia el monto sin la base histórica

## Intención

La base pertenece al periodo para el que se calculó.

## Escenario

```gherkin
Dada una línea aplicada desde el historial
Cuando clono el plan
Entonces el clon no lleva la base
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
