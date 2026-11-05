---
id: TC-PLANNING-HISTBUDGET-009
title: "Con menos de cuatro valores no se excluyen atípicos"
spec: planning/budgets
related_specs: []
requirement: "Exclusión de valores atípicos"
scenario: "Muestra chica sin exclusión"
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
  - "Real de \"Supermercado\": 1380.00, 3950.00 y 1474.50 BOB en los 3 últimos periodos"
input: {"N":3}
steps:
  - "Pedir la sugerencia con N = 3"
expected_result:
  - "Ningún valor excluido"
  - "Sugerencia 2268.17 BOB (6804.50 ÷ 3 = 2268.1666…)"
  - "Explicación con outlierRule NONE_SMALL_SAMPLE"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-009 — Con menos de cuatro valores no se excluyen atípicos

## Intención

Con muestras chicas la regla no actúa y lo dice.

## Escenario

```gherkin
Dados 3 valores
Cuando pido la sugerencia
Entonces no hay exclusión automática y la explicación lo indica
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
