---
id: TC-PLANNING-HISTBUDGET-014
title: "Redondeo de la sugerencia al múltiplo de 50"
spec: planning/budgets
related_specs: []
requirement: "Redondeo opcional a un múltiplo"
scenario: "Supermercado a múltiplos de 50"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/historical-budget-estimator.test.ts
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
  - "Sugerencia de \"Supermercado\" 1480.00 BOB"
input: {"roundingIncrement":50}
steps:
  - "Pedir la sugerencia con incremento 50"
expected_result:
  - "Sugerencia mostrada 1500.00 BOB (29.6 múltiplos → 30)"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-014 — Redondeo de la sugerencia al múltiplo de 50

## Intención

Montos redondos para planificar, con HALF_EVEN.

## Escenario

```gherkin
Dada una sugerencia de 1480.00 BOB
Cuando elijo múltiplos de 50
Entonces veo 1500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
