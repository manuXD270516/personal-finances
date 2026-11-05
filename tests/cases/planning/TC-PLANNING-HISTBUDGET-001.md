---
id: TC-PLANNING-HISTBUDGET-001
title: "Promedio de cuatro periodos terminados para una línea de gasto"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia por promedio de los periodos anteriores"
scenario: "Promedio de cuatro periodos de supermercado"
requirement_status: provisional
fr: ["FR-PLANNING-021","FR-PLANNING-023"]
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
  - "Real de \"Supermercado\": 1380.00 BOB (2026-07), 1515.50 BOB (2026-08), 1610.00 BOB (2026-09), 1474.50 BOB (2026-10)"
input: {"periodo":"2026-11","metodo":"AVERAGE","N":4}
steps:
  - "Pedir la sugerencia de \"Supermercado\" para 2026-11 con N = 4"
expected_result:
  - "Sugerencia 1495.00 BOB (5980.00 ÷ 4)"
  - "Método promedio, 4 periodos usados"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-001 — Promedio de cuatro periodos terminados para una línea de gasto

## Intención

El promedio usa el real del presupuesto en la moneda del plan y redondea HALF_EVEN.

## Escenario

```gherkin
Dado el real de Supermercado de julio a octubre
Cuando pido la sugerencia con N = 4
Entonces es 1495.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
