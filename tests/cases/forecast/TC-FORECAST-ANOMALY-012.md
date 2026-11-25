---
id: TC-FORECAST-ANOMALY-012
title: "Un gasto registrado tarde dentro de los 7 días se evalúa"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Detección diaria sin depender del servicio de pronósticos"
scenario: "Gasto registrado tarde"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-FORECAST-006"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2026-11-13 se registra un gasto atípico con fecha 2026-11-09"
  - "corre el trabajo diario del 2026-11-14"
expected_result:
  - "el gasto se evalúa y queda marcado"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-012 — Un gasto registrado tarde dentro de los 7 días se evalúa

## Intención

Verifica el scenario "Gasto registrado tarde" del requirement "Detección diaria sin depender del servicio de pronósticos" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el 2026-11-13 se registra un gasto atípico con fecha 2026-11-09
Y corre el trabajo diario del 2026-11-14
Entonces el gasto se evalúa y queda marcado
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
