---
id: TC-PLANNING-HISTBUDGET-020
title: "Confirmar dos de tres líneas con un monto editado a mano"
spec: planning/budgets
related_specs: ["planning/budget-templates"]
requirement: "Aplicación revisable con confirmación explícita"
scenario: "Aplicar dos de tres líneas"
requirement_status: confirmed
fr: ["FR-PLANNING-021","FR-PLANNING-013"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/budget-suggestions.api.test.ts
  - apps/web/src/ui/planning/suggestions.test.tsx
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
  - tests/e2e/specs/budget-suggestions.spec.ts
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
  - "Plan de 2026-11 desde \"Mes estándar\" con \"Supermercado\" máximo 1500.00 BOB, \"Restaurantes\" máximo 600.00 BOB y \"Salario\" esperado 7800.00 BOB"
  - "Sugerencias: 1480.00, 630.00 y 8000.00 BOB"
input: {"lines":[{"target":"Supermercado","amount":"1480.00"},{"target":"Restaurantes","amount":"650.00","suggestedAmount":"630.00"}]}
steps:
  - "POST W/budget-suggestions/confirm con el token de la vista previa"
expected_result:
  - "\"Supermercado\" máximo 1480.00 BOB y overridden = true"
  - "\"Mes estándar\" sin versión nueva"
  - "\"Restaurantes\" 650.00 BOB con historyBasis suggested 630.00 y applied 650.00"
  - "\"Salario\" sigue en 7800.00 BOB"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-020 — Confirmar dos de tres líneas con un monto editado a mano

## Intención

Solo se aplica lo elegido, con el monto que decide el EDITOR y su base.

## Escenario

```gherkin
Dadas tres sugerencias
Cuando confirmo dos y edito una
Entonces solo cambian esas dos y el template queda igual
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
