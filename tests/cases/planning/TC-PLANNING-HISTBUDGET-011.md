---
id: TC-PLANNING-HISTBUDGET-011
title: "Reincluir un periodo atípico cambia la sugerencia"
spec: planning/budgets
related_specs: []
requirement: "Exclusión e inclusión manual de periodos"
scenario: "Volver a incluir el mes del viaje"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: low
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
  - "Datos de TC-PLANNING-HISTBUDGET-008"
input: {"N":6,"overrides":[{"target":"Supermercado","includePeriodIds":["2026-08"]}]}
steps:
  - "Pedir la sugerencia incluyendo 2026-08"
expected_result:
  - "Sugerencia 1891.67 BOB (11350.00 ÷ 6)"
  - "Un periodo INCOMPLETE o NO_RATE en includePeriodIds se rechaza con VALIDATION_FAILED"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-011 — Reincluir un periodo atípico cambia la sugerencia

## Intención

La inclusión manual solo aplica a atípicos.

## Escenario

```gherkin
Dado agosto marcado atípico
Cuando lo vuelvo a incluir
Entonces la sugerencia es 1891.67 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
