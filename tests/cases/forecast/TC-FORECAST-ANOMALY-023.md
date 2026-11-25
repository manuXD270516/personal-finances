---
id: TC-FORECAST-ANOMALY-023
title: "Un gasto atípico de otro workspace responde como inexistente"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Permisos, auditoría y aislamiento de los gastos atípicos"
scenario: "Gasto atípico de otro workspace"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003","NFR-SEC-004"]
invariants: []
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/spending-anomalies.api.test.ts
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - packages/contexts/forecasting/test/integration/pg-forecasting.int.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies","rls"]
error_code: "RESOURCE_NOT_FOUND"
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el OWNER de \"W1\" intenta descartar un gasto atípico de \"W2\" por su id"
expected_result:
  - "se responde 404 RESOURCE_NOT_FOUND y el gasto atípico de \"W2\" no cambia"
  - "la tabla forecasting.spending_anomaly tiene RLS forzada y está registrada en platform.workspace_scoped_table"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-023 — Un gasto atípico de otro workspace responde como inexistente

## Intención

Verifica el scenario "Gasto atípico de otro workspace" del requirement "Permisos, auditoría y aislamiento de los gastos atípicos" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-IDENTITY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el OWNER de "W1" intenta descartar un gasto atípico de "W2" por su id
Entonces se responde 404 RESOURCE_NOT_FOUND y el gasto atípico de "W2" no cambia
Y la tabla forecasting.spending_anomaly tiene RLS forzada y está registrada en platform.workspace_scoped_table
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
