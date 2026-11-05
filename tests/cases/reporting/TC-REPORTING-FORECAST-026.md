---
id: TC-REPORTING-FORECAST-026
title: "Los esenciales de un periodo posterior se prorratean por días y una categoría sin línea no resta"
spec: reporting/dashboard
related_specs: []
requirement: "Esenciales presupuestados restantes descontados del disponible"
scenario: "Esenciales del periodo siguiente proporcionales"
requirement_status: provisional
fr: ["FR-PLANNING-024"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["spendable","q5","essentials"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Datos de TC-REPORTING-FORECAST-024"
  - "Esenciales \"Supermercado\" (y \"Transporte\" sin línea); \"2026-10\": 1200.00 planificados y 750.00 gastados; \"2026-11\": 1200.00 planificados"
input: {}
steps:
  - "Calcular el disponible"
expected_result:
  - "Esenciales 650.00 BOB (450.00 + 1200.00 × 5 / 30); disponible 3870.00 BOB"
  - "\"Transporte\" no resta y se indica sin línea en el plan"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-026 — Los esenciales de un periodo posterior se prorratean por días y una categoría sin línea no resta

## Intención

Prorrateo exacto sin redondeo intermedio.

## Escenario

```gherkin
Dado Esenciales "Supermercado" (y "Transporte" sin línea); "2026-10": 1200.00 planificados y 750.00 gastados; "2026-11": 1200.00 planificados
Cuando Calcular el disponible
Entonces Esenciales 650.00 BOB (450.00 + 1200.00 × 5 / 30); disponible 3870.00 BOB
  Y "Transporte" no resta y se indica sin línea en el plan
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Esenciales presupuestados restantes descontados del disponible" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
