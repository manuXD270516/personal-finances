---
id: TC-FORECAST-ANOMALY-011
title: "La detección corre con los pronósticos deshabilitados y sin crear corridas"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Detección diaria sin depender del servicio de pronósticos"
scenario: "Pronósticos deshabilitados"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: high
type: integration
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
  - "FORECASTING_ENABLED=false y FORECASTING_ANOMALIES_ENABLED=true, y el 2026-11-12 se registró un gasto atípico"
  - "corre el trabajo diario del 2026-11-13"
expected_result:
  - "el gasto queda marcado"
  - "no se crea ninguna corrida de pronóstico y el ejecutor de corridas no está registrado"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-011 — La detección corre con los pronósticos deshabilitados y sin crear corridas

## Intención

Verifica el scenario "Pronósticos deshabilitados" del requirement "Detección diaria sin depender del servicio de pronósticos" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando FORECASTING_ENABLED=false y FORECASTING_ANOMALIES_ENABLED=true, y el 2026-11-12 se registró un gasto atípico
Y corre el trabajo diario del 2026-11-13
Entonces el gasto queda marcado
Y no se crea ninguna corrida de pronóstico y el ejecutor de corridas no está registrado
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
