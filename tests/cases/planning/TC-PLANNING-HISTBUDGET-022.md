---
id: TC-PLANNING-HISTBUDGET-022
title: "Gasto nuevo entre vista previa y confirmación da sugerencia obsoleta"
spec: planning/budgets
related_specs: []
requirement: "Sugerencia obsoleta al confirmar"
scenario: "Gasto registrado entre la vista previa y la confirmación"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
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
error_code: BUDGET_SUGGESTION_STALE
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
  - "Datos de TC-PLANNING-HISTBUDGET-008 y vista previa con 1480.00 BOB"
input: {}
steps:
  - "Registrar un gasto de 200.00 BOB en \"Supermercado\" con fecha 2026-09-12"
  - "Confirmar \"Supermercado\" con el token anterior"
expected_result:
  - "409 BUDGET_SUGGESTION_STALE (la sugerencia recalculada es 1520.00 BOB)"
  - "El plan no cambia"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-022 — Gasto nuevo entre vista previa y confirmación da sugerencia obsoleta

## Intención

El token protege lo que el EDITOR revisó.

## Escenario

```gherkin
Dada una vista previa
Cuando cambia la historia y confirmo
Entonces se rechaza por obsoleta
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
