---
id: TC-PLANNING-HISTBUDGET-004
title: "Empate del promedio redondeado HALF_EVEN a la escala de la moneda"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia por promedio de los periodos anteriores"
scenario: "Empate en el redondeo del promedio"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
type: property
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
  - "Real de \"Internet\": 100.00 BOB (2026-09) y 100.01 BOB (2026-10)"
input: {"N":2}
steps:
  - "Pedir la sugerencia de \"Internet\" con N = 2"
expected_result:
  - "Sugerencia 100.00 BOB (100.005 redondeado HALF_EVEN; HALF_UP daría 100.01)"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-004 — Empate del promedio redondeado HALF_EVEN a la escala de la moneda

## Intención

El redondeo es HALF_EVEN y determinista (regla de integridad del proyecto).

## Escenario

```gherkin
Dado un promedio de 100.005 BOB
Cuando se redondea
Entonces queda 100.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
