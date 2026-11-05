---
id: TC-PLANNING-HISTBUDGET-003
title: "La ventana de un periodo futuro excluye el periodo en curso"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia por promedio de los periodos anteriores"
scenario: "Planificar un periodo futuro excluye el periodo en curso"
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
  - "FixedClock en 2026-11-20T10:00:00-04:00"
  - "Periodo \"2026-12\" en borrador"
input: {"periodo":"2026-12","N":3}
steps:
  - "Pedir sugerencias para 2026-12 con N = 3"
expected_result:
  - "Ventana: 2026-08, 2026-09 y 2026-10"
  - "2026-11 informado como IN_PROGRESS y fuera del promedio"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-003 — La ventana de un periodo futuro excluye el periodo en curso

## Intención

Solo periodos terminados antes de hoy y del inicio del objetivo.

## Escenario

```gherkin
Dado hoy 2026-11-20
Cuando pido sugerencias para diciembre
Entonces noviembre queda en curso y no cuenta
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
