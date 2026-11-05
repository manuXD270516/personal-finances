---
id: TC-PLANNING-HISTBUDGET-012
title: "Mismo periodo del año anterior con ajuste y empate HALF_EVEN"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia por el mismo periodo del año anterior"
scenario: "Noviembre del año pasado más 10 %"
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
  - "Real de \"Hogar\" en 2025-11: 1000.15 BOB"
input: {"periodo":"2026-11","metodo":"SAME_PERIOD_LAST_YEAR","adjustmentPercent":"10.00"}
steps:
  - "Pedir la sugerencia de \"Hogar\" con el método del año anterior y ajuste 10.00 %"
expected_result:
  - "Sugerencia 1100.16 BOB (1100.165 HALF_EVEN; HALF_UP daría 1100.17)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-012 — Mismo periodo del año anterior con ajuste y empate HALF_EVEN

## Intención

Ajuste porcentual exacto y redondeo HALF_EVEN.

## Escenario

```gherkin
Dado Hogar con 1000.15 BOB en noviembre de 2025
Cuando pido el método del año anterior +10 %
Entonces la sugerencia es 1100.16 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
