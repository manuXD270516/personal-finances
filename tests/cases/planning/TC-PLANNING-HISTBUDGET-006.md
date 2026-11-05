---
id: TC-PLANNING-HISTBUDGET-006
title: "Periodo con gasto sin tasa excluido solo para esa línea"
spec: planning/budgets
related_specs: ["fx/market-rates"]
requirement: "Exclusión de periodos incompletos"
scenario: "Gasto en dólares sin tasa en un periodo"
requirement_status: provisional
fr: ["FR-PLANNING-021","FR-PLANNING-023"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
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
  - "\"Viajes\" de 2026-09 incluye 40.00 USD de una fecha sin tasa de valoración dentro de la ventana de vigencia"
  - "Real de \"Viajes\": 300.00 BOB (2026-08) y 500.00 BOB (2026-10)"
input: {"periodo":"2026-11","N":3}
steps:
  - "Pedir la sugerencia de \"Viajes\" con N = 3"
expected_result:
  - "2026-09 con estado NO_RATE para \"Viajes\""
  - "Sugerencia 400.00 BOB"
  - "Las demás líneas de 2026-09 no cambian de estado"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-006 — Periodo con gasto sin tasa excluido solo para esa línea

## Intención

Sin tasa no se convierte 1:1 (D109): el periodo no entra en el promedio de esa línea.

## Escenario

```gherkin
Dado un gasto en USD sin tasa en septiembre
Cuando pido la sugerencia de Viajes
Entonces septiembre queda NO_RATE y la sugerencia es 400.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
