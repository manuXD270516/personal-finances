---
id: TC-PLANNING-HISTBUDGET-015
title: "Empate al múltiplo resuelto al múltiplo par"
spec: planning/budgets
related_specs: []
requirement: "Redondeo opcional a un múltiplo"
scenario: "Empate al múltiplo par"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: low
type: property
level: domain
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
  - "Sugerencia de \"Taxi\" 125.00 BOB"
input: {"roundingIncrement":50}
steps:
  - "Pedir la sugerencia con incremento 50"
expected_result:
  - "Sugerencia mostrada 100.00 BOB (2.5 → 2 con HALF_EVEN)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-015 — Empate al múltiplo resuelto al múltiplo par

## Intención

El redondeo al múltiplo también es HALF_EVEN.

## Escenario

```gherkin
Dada una sugerencia de 125.00 BOB
Cuando elijo múltiplos de 50
Entonces veo 100.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
