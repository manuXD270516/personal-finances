---
id: TC-FORECAST-ANOMALY-032
title: "El runner de la evaluación acepta umbrales por argumento sin cambiar la configuración"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Evaluación contra las anomalías etiquetadas del Large Seed"
scenario: "Rejilla con umbrales por argumento"
requirement_status: confirmed
fr: ["FR-FORECAST-010", "FR-FORECAST-007"]
nfr: []
invariants: []
priority: low
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/src/forecasting/anomaly-backtest-cli.test.ts
  - packages/contexts/forecasting/src/application/backtest-spending-anomalies.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies", "calibration", "cli"]
error_code: null
preconditions:
  - "Workspace con gastos y etiquetas del Large Seed exportadas; configuración del worker con los parámetros por omisión"
input: {}
steps:
  - "se corre `forecast-anomalies-backtest --workspace <id> --labels <ruta> --robust-z 10 --new-counterparty-percentile 99.5`"
expected_result:
  - "el informe muestra robustZ 10 y percentil 99.5 como umbrales usados"
  - "la configuración del worker sigue con sus valores"
  - "no se persiste ningún gasto atípico"
created: 2026-11-25
updated: 2026-11-26
---

# TC-FORECAST-ANOMALY-032 — El runner de la evaluación acepta umbrales por argumento sin cambiar la configuración

## Intención

Verifica el scenario "Rejilla con umbrales por argumento" del requirement "Evaluación contra las anomalías etiquetadas del Large Seed" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace con gastos y etiquetas del Large Seed exportadas; configuración del worker con los parámetros por omisión
Cuando se corre `forecast-anomalies-backtest --workspace <id> --labels <ruta> --robust-z 10 --new-counterparty-percentile 99.5`
Entonces el informe muestra robustZ 10 y percentil 99.5 como umbrales usados
Y la configuración del worker sigue con sus valores
Y no se persiste ningún gasto atípico
```

## Notas

- Change `refine-spending-anomaly-calibration` (Phase 9), decisión 5 del design. Datos sintéticos del Large Seed; ningún dato real del owner.
