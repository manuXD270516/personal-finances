---
id: TC-PLANNING-HISTBUDGET-013
title: "Sin el periodo del año anterior la línea queda sin sugerencia"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia por el mismo periodo del año anterior"
scenario: "Sin el mismo periodo del año anterior"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
  - packages/contexts/planning/src/domain/historical-budget-estimator.test.ts
  - packages/contexts/planning/src/domain/suggestion-window.test.ts
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
  - "Primera actividad del workspace el 2026-02-01"
input: {"periodo":"2026-11","metodo":"SAME_PERIOD_LAST_YEAR"}
steps:
  - "Pedir sugerencias con el método del año anterior"
expected_result:
  - "Cada línea en INSUFFICIENT_HISTORY"
  - "2025-11 con estado BEFORE_FIRST_ACTIVITY"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-013 — Sin el periodo del año anterior la línea queda sin sugerencia

## Intención

El periodo homólogo se calcula con el calendario aunque no exista como fila.

## Escenario

```gherkin
Dada la primera actividad en febrero de 2026
Cuando pido el método del año anterior para noviembre
Entonces no hay sugerencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
