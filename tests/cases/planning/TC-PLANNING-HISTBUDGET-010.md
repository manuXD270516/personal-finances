---
id: TC-PLANNING-HISTBUDGET-010
title: "El EDITOR excluye a mano un periodo de una línea"
spec: planning/budgets
related_specs: []
requirement: "Exclusión e inclusión manual de periodos"
scenario: "Excluir el mes del aguinaldo"
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
  - "Real de \"Ropa\": 300.00, 280.00, 320.00 y 300.00 BOB de 2026-07 a 2026-10"
input: {"N":4,"overrides":[{"target":"Ropa","excludePeriodIds":["2026-10"]}]}
steps:
  - "Pedir la sugerencia de \"Ropa\" con N = 4 excluyendo 2026-10"
expected_result:
  - "Sugerencia 300.00 BOB con 3 periodos usados"
  - "2026-10 con estado USER_EXCLUDED"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-010 — El EDITOR excluye a mano un periodo de una línea

## Intención

El usuario conoce meses excepcionales que la regla no detecta.

## Escenario

```gherkin
Dado el real de Ropa de 4 meses
Cuando excluyo octubre
Entonces la sugerencia es 300.00 BOB y octubre figura excluido por mí
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
