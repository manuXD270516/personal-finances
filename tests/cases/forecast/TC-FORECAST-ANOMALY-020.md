---
id: TC-FORECAST-ANOMALY-020
title: "Corregir el monto dentro de la ventana reemplaza el gasto atípico"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Cambios de la transacción después de la detección"
scenario: "Monto corregido"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
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
  - "el gasto atípico de 304.00 BOB del 2026-11-12 se corrige el 2026-11-13 a 30.40 BOB"
  - "corre el trabajo diario del 2026-11-14"
expected_result:
  - "el gasto atípico anterior queda SUPERSEDED y no se muestra"
  - "la versión nueva se evalúa y no se marca"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-020 — Corregir el monto dentro de la ventana reemplaza el gasto atípico

## Intención

Verifica el scenario "Monto corregido" del requirement "Cambios de la transacción después de la detección" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el gasto atípico de 304.00 BOB del 2026-11-12 se corrige el 2026-11-13 a 30.40 BOB
Y corre el trabajo diario del 2026-11-14
Entonces el gasto atípico anterior queda SUPERSEDED y no se muestra
Y la versión nueva se evalúa y no se marca
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
