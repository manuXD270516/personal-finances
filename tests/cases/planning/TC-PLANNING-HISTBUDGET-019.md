---
id: TC-PLANNING-HISTBUDGET-019
title: "La vista previa no modifica el plan ni audita"
spec: planning/budgets
related_specs: []
requirement: "Aplicación revisable con confirmación explícita"
scenario: "Vista previa sin efectos"
requirement_status: provisional
fr: ["FR-PLANNING-021","FR-PLANNING-013"]
nfr: []
invariants: ["INV-029"]
priority: high
type: api
level: api
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
input: {}
steps:
  - "POST W/budget-suggestions/preview para 2026-11"
  - "Consultar el plan y su historial"
expected_result:
  - "El plan conserva versión y montos"
  - "El historial no tiene registros nuevos"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-019 — La vista previa no modifica el plan ni audita

## Intención

Pedir sugerencias es solo lectura.

## Escenario

```gherkin
Dado el plan de noviembre
Cuando pido sugerencias y no confirmo
Entonces nada cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
