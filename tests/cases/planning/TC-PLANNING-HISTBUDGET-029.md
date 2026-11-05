---
id: TC-PLANNING-HISTBUDGET-029
title: "Vista previa de doce periodos y sesenta líneas en p95 de 800 ms"
spec: planning/budgets
related_specs: []
requirement: "Rendimiento de la vista previa histórica"
scenario: "Doce periodos en el seed large"
requirement_status: provisional
fr: ["FR-PLANNING-021"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: medium
type: platform
level: performance
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
  - "Seed `large` restaurado"
  - "Plan con 60 líneas"
input: {"N":12,"lineas":60}
steps:
  - "Benchmark nightly de previewBudgetSuggestions"
expected_result:
  - "p95 del servidor ≤ 800 ms"
  - "Una consulta de agregados y un lote de tasas por pedido"
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-029 — Vista previa de doce periodos y sesenta líneas en p95 de 800 ms

## Intención

Alineado con NFR-PERF-006 (reportes de 12 meses).

## Escenario

```gherkin
Dado el seed large
Cuando pido sugerencias con N = 12
Entonces el p95 es 800 ms o menos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
