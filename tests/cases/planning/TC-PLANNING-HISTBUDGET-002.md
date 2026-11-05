---
id: TC-PLANNING-HISTBUDGET-002
title: "Un periodo sin gasto cuenta como cero en el promedio"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia por promedio de los periodos anteriores"
scenario: "Periodo sin gasto cuenta como cero"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
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
  - "Real de \"Regalos\": 0.00 BOB (2026-08, sin movimientos), 300.00 BOB (2026-09), 150.00 BOB (2026-10)"
input: {"periodo":"2026-11","N":3}
steps:
  - "Pedir la sugerencia de \"Regalos\" con N = 3"
expected_result:
  - "Sugerencia 150.00 BOB (450.00 ÷ 3)"
  - "2026-08 figura como USED con 0.00 BOB"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-002 — Un periodo sin gasto cuenta como cero en el promedio

## Intención

Un mes sin gasto es un dato válido; tratarlo como faltante inflaría el promedio.

## Escenario

```gherkin
Dado un mes sin gasto en Regalos
Cuando pido la sugerencia con N = 3
Entonces el mes cuenta como 0.00 y la sugerencia es 150.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
