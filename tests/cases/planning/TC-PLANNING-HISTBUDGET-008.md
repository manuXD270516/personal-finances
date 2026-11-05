---
id: TC-PLANNING-HISTBUDGET-008
title: "Vallas de Tukey excluyen el mes atípico del promedio"
spec: planning/budgets
related_specs: []
requirement: "Exclusión de valores atípicos"
scenario: "Mes del viaje excluido"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
type: domain
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
  - "Real de \"Supermercado\" de 2026-05 a 2026-10: 1420.00, 1515.50, 1380.00, 3950.00, 1610.00 y 1474.50 BOB"
input: {"periodo":"2026-11","N":6}
steps:
  - "Pedir la sugerencia de \"Supermercado\" con N = 6"
expected_result:
  - "Q1 1420.00 BOB, Q3 1610.00 BOB, valla superior 1895.00 BOB"
  - "2026-08 (3950.00 BOB) con estado OUTLIER"
  - "Sugerencia 1480.00 BOB (7400.00 ÷ 5)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-008 — Vallas de Tukey excluyen el mes atípico del promedio

## Intención

Cuartiles por medianas de las mitades y 1.5 × RIC, con Decimal exacto.

## Escenario

```gherkin
Dado un mes de 3950.00 BOB entre meses de ~1500.00 BOB
Cuando pido la sugerencia con N = 6
Entonces ese mes queda atípico y la sugerencia es 1480.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
