---
id: TC-PLANNING-HISTBUDGET-007
title: "Menos valores válidos que la mitad de N deja la línea sin sugerencia"
spec: planning/budgets
related_specs: []
requirement: "Historia insuficiente"
scenario: "Un solo periodo válido de tres"
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
  - "Primera actividad del workspace el 2026-09-10"
input: {"periodo":"2026-11","N":3}
steps:
  - "Pedir sugerencias con N = 3"
expected_result:
  - "Cada línea en INSUFFICIENT_HISTORY con 1 valor válido de 2 necesarios"
  - "Ninguna línea con monto sugerido"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-007 — Menos valores válidos que la mitad de N deja la línea sin sugerencia

## Intención

Mínimo ⌈N/2⌉ valores válidos.

## Escenario

```gherkin
Dada la primera actividad el 2026-09-10
Cuando pido sugerencias con N = 3
Entonces todas las líneas quedan con historia insuficiente
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
