---
id: TC-FORECAST-ANOMALY-024
title: "Un workspace importado empieza sin gastos atípicos"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Retención y portabilidad de los gastos atípicos"
scenario: "Workspace importado"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-IDENTITY-010"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/src/portability/portability-coverage.test.ts
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - packages/contexts/forecasting/test/integration/pg-forecasting.int.test.ts
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
  - "se importa en un workspace nuevo la exportación de \"W1\", que tenía 4 gastos atípicos"
  - "corre el trabajo diario"
expected_result:
  - "la exportación no contiene gastos atípicos ni descartes"
  - "el workspace nuevo no tiene gastos atípicos hasta el trabajo diario, que solo evalúa los últimos 7 días"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-024 — Un workspace importado empieza sin gastos atípicos

## Intención

Verifica el scenario "Workspace importado" del requirement "Retención y portabilidad de los gastos atípicos" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-IDENTITY-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando se importa en un workspace nuevo la exportación de "W1", que tenía 4 gastos atípicos
Y corre el trabajo diario
Entonces la exportación no contiene gastos atípicos ni descartes
Y el workspace nuevo no tiene gastos atípicos hasta el trabajo diario, que solo evalúa los últimos 7 días
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
