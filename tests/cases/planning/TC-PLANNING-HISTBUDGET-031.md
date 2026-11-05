---
id: TC-PLANNING-HISTBUDGET-031
title: "Propiedades del estimador histórico ante permutaciones y valores aleatorios"
spec: planning/budgets
related_specs: []
requirement: "Exclusión de valores atípicos"
scenario: null
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: []
invariants: []
priority: medium
type: property
level: property
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
  - "Generador de 1 a 12 valores decimales no negativos con escala 2"
input: {"corridas":200}
steps:
  - "Ejecutar el estimador con los valores y con permutaciones de ellos"
expected_result:
  - "Mismo resultado para cualquier orden"
  - "Sin ajuste, la sugerencia queda entre el mínimo y el máximo de los usados"
  - "Nunca queda un solo valor usado si ese valor es atípico"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-031 — Propiedades del estimador histórico ante permutaciones y valores aleatorios

## Intención

Determinismo del cálculo (PBT con timeout explícito).

## Escenario

```gherkin
Dados valores aleatorios
Cuando los permuto
Entonces la sugerencia no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
