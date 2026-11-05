---
id: TC-PLANNING-HISTBUDGET-018
title: "Periodo sin plan propone líneas para categorías raíz con gasto"
spec: planning/budgets
related_specs: []
requirement: "Líneas a las que se aplica la sugerencia"
scenario: "Periodo sin plan"
requirement_status: provisional
fr: ["FR-PLANNING-021","FR-PLANNING-015"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
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
  - "\"2026-12\" sin plan"
  - "Categorías raíz \"Alimentación\", \"Transporte\" y \"Mascotas\"; en la ventana hubo gasto en las dos primeras y ninguno en \"Mascotas\""
input: {}
steps:
  - "Pedir sugerencias para 2026-12"
expected_result:
  - "Líneas propuestas para \"Alimentación\" y \"Transporte\" (MAXIMUM)"
  - "Ninguna para \"Mascotas\""
  - "Ningún objetivo propuesto se solapa con otro"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-018 — Periodo sin plan propone líneas para categorías raíz con gasto

## Intención

Descubrimiento sin plan previo.

## Escenario

```gherkin
Dado un periodo sin plan
Cuando pido sugerencias
Entonces se proponen solo las categorías raíz con gasto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
