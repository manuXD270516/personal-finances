---
id: TC-FORECAST-ANOMALY-025
title: "El backtesting calcula precisión y recall sin contar otras etiquetas"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Evaluación contra las anomalías etiquetadas del Large Seed"
scenario: "Umbrales cumplidos"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-FORECAST-007"]
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/perf/anomalies.perf.ts
  - apps/api/src/forecasting/anomaly-backtest-cli.test.ts
  - packages/contexts/forecasting/src/application/backtest-spending-anomalies.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la evaluación marca 140 gastos: 100 con etiqueta OUTLIER o NEW_COUNTERPARTY_FRAUD, 10 con otra etiqueta y 30 sin etiqueta"
  - "hay 125 gastos con esas dos etiquetas"
expected_result:
  - "la precisión es 0.7692 y el recall 0.8000"
  - "la fila del nightly pasa (umbrales 0.60 y 0.70)"
  - "el informe no contiene montos ni descripciones"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-025 — El backtesting calcula precisión y recall sin contar otras etiquetas

## Intención

Verifica el scenario "Umbrales cumplidos" del requirement "Evaluación contra las anomalías etiquetadas del Large Seed" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando la evaluación marca 140 gastos: 100 con etiqueta OUTLIER o NEW_COUNTERPARTY_FRAUD, 10 con otra etiqueta y 30 sin etiqueta
Y hay 125 gastos con esas dos etiquetas
Entonces la precisión es 0.7692 y el recall 0.8000
Y la fila del nightly pasa (umbrales 0.60 y 0.70)
Y el informe no contiene montos ni descripciones
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- Con el Large Seed real lo mide el nightly (`pnpm forecast:anomalies:backtest`); este TC prueba el cálculo con conteos fijos.
