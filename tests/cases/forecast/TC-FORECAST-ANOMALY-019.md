---
id: TC-FORECAST-ANOMALY-019
title: "Restaurar un gasto descartado lo vuelve a abrir"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Descartar y restaurar un gasto atípico"
scenario: "Restaurar"
requirement_status: confirmed
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/spending-anomalies.api.test.ts
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - tests/e2e/specs/spending-anomalies.spec.ts
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
  - "el gasto atípico de 304.00 BOB está descartado"
  - "el EDITOR lo restaura"
expected_result:
  - "la respuesta es 204 y vuelve a figurar entre los abiertos con su marca"
  - "queda un registro de auditoría RESTORE"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-019 — Restaurar un gasto descartado lo vuelve a abrir

## Intención

Verifica el scenario "Restaurar" del requirement "Descartar y restaurar un gasto atípico" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el gasto atípico de 304.00 BOB está descartado
Y el EDITOR lo restaura
Entonces la respuesta es 204 y vuelve a figurar entre los abiertos con su marca
Y queda un registro de auditoría RESTORE
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
