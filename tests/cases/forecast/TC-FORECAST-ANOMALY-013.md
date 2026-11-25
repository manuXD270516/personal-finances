---
id: TC-FORECAST-ANOMALY-013
title: "Con la detección habilitada el worker mantiene consumidores y conexiones"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Detección diaria sin depender del servicio de pronósticos"
scenario: "Presupuesto de conexiones intacto"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["anomalies","connections"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el worker arranca con la plantilla del host, FORECASTING_ENABLED=false y FORECASTING_ANOMALIES_ENABLED=true"
expected_result:
  - "la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la detección (28 + 4 = 32 de 34)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-013 — Con la detección habilitada el worker mantiene consumidores y conexiones

## Intención

Verifica el scenario "Presupuesto de conexiones intacto" del requirement "Detección diaria sin depender del servicio de pronósticos" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el worker arranca con la plantilla del host, FORECASTING_ENABLED=false y FORECASTING_ANOMALIES_ENABLED=true
Entonces la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la detección (28 + 4 = 32 de 34)
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
