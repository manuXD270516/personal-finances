---
id: TC-PLANNING-HISTBUDGET-016
title: "Explicación por línea con periodos, estados, promedio, mediana y diferencia"
spec: planning/budgets
related_specs: []
requirement: "Explicación de cada sugerencia"
scenario: "Explicación del supermercado"
requirement_status: confirmed
fr: ["FR-PLANNING-021"]
nfr: ["NFR-USAB-104"]
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/budget-suggestions.api.test.ts
  - apps/web/src/ui/planning/suggestions.test.tsx
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
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
  - "Datos de TC-PLANNING-HISTBUDGET-008"
  - "Plan de 2026-11 con \"Supermercado\" máximo 1500.00 BOB"
input: {"operacion":"previewBudgetSuggestions","N":6}
steps:
  - "POST W/budget-suggestions/preview para 2026-11"
expected_result:
  - "La línea lista 6 periodos con sus reales y 2026-08 OUTLIER"
  - "usedCount 5, mean 1480.00, median 1474.50"
  - "currentAmount 1500.00 BOB y difference −20.00 BOB"
  - "Sin textos libres: solo códigos y montos"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-016 — Explicación por línea con periodos, estados, promedio, mediana y diferencia

## Intención

La sugerencia es explicable; la UI arma el texto en es/en/pt.

## Escenario

```gherkin
Dado el plan con Supermercado en 1500.00 BOB
Cuando pido la vista previa
Entonces la explicación muestra los 6 periodos, el atípico y la diferencia −20.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
