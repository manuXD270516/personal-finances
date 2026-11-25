---
id: TC-FORECAST-ANOMALY-022
title: "Un VIEWER no puede descartar un gasto atípico"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Permisos, auditoría y aislamiento de los gastos atípicos"
scenario: "VIEWER intenta descartar"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/spending-anomalies.api.test.ts
  - apps/web/src/ui/spending-anomalies/spending-anomalies.test.tsx
status: automated
regression_suite: false
phase: 9
tags: ["anomalies","rbac"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un VIEWER intenta POST /workspaces/{id}/spending-anomalies/{anomalyId}/dismiss"
expected_result:
  - "se rechaza con 403 y el gasto atípico sigue abierto"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-022 — Un VIEWER no puede descartar un gasto atípico

## Intención

Verifica el scenario "VIEWER intenta descartar" del requirement "Permisos, auditoría y aislamiento de los gastos atípicos" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-IDENTITY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando un VIEWER intenta POST /workspaces/{id}/spending-anomalies/{anomalyId}/dismiss
Entonces se rechaza con 403 y el gasto atípico sigue abierto
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
