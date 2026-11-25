---
id: TC-FORECAST-ANOMALY-016
title: "La lista muestra los gastos atípicos abiertos del más reciente al más antiguo"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Lista de gastos atípicos y marca en la transacción"
scenario: "Lista con dos gastos atípicos"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
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
  - "\"W1\" tiene dos gastos atípicos abiertos del 2026-11-12 y del 2026-11-14"
  - "un VIEWER pide GET /workspaces/{id}/spending-anomalies"
expected_result:
  - "la respuesta 200 trae primero el del 2026-11-14 y luego el del 2026-11-12, cada uno con sus motivos y featureStatus ENABLED"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-016 — La lista muestra los gastos atípicos abiertos del más reciente al más antiguo

## Intención

Verifica el scenario "Lista con dos gastos atípicos" del requirement "Lista de gastos atípicos y marca en la transacción" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando "W1" tiene dos gastos atípicos abiertos del 2026-11-12 y del 2026-11-14
Y un VIEWER pide GET /workspaces/{id}/spending-anomalies
Entonces la respuesta 200 trae primero el del 2026-11-14 y luego el del 2026-11-12, cada uno con sus motivos y featureStatus ENABLED
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
