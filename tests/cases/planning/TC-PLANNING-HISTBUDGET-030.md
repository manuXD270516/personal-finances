---
id: TC-PLANNING-HISTBUDGET-030
title: "La base histórica de las líneas sobrevive la ida y vuelta del export"
spec: identity/workspace-portability
related_specs: ["planning/budgets"]
requirement: "Base histórica de las líneas del plan en el export"
scenario: "Ida y vuelta de una línea aplicada desde el historial"
requirement_status: provisional
fr: ["FR-IDENTITY-010","FR-IDENTITY-017","FR-PLANNING-021"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
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
  - "\"Supermercado\" de 2026-11 aplicado con 1480.00 BOB desde el promedio de 6 periodos con 2026-08 atípico"
input: {}
steps:
  - "Exportar \"W1\""
  - "Importar en un workspace nuevo"
  - "Consultar el plan de 2026-11"
expected_result:
  - "La línea tiene 1480.00 BOB"
  - "La misma base: 6 periodos, 2026-08 OUTLIER, sugerido 1480.00 BOB, con ids de periodo del workspace nuevo"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-030 — La base histórica de las líneas sobrevive la ida y vuelta del export

## Intención

Portabilidad completa (FR-IDENTITY-017).

## Escenario

```gherkin
Dada una línea aplicada desde el historial
Cuando exporto e importo el workspace
Entonces la base se conserva
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
