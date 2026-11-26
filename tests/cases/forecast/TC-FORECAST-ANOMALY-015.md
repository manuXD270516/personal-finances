---
id: TC-FORECAST-ANOMALY-015
title: "Marcar un gasto atípico no cambia la transacción ni sus asientos"
spec: forecast/anomaly-detection
related_specs: []
requirement: "La detección nunca bloquea ni modifica transacciones"
scenario: "Gasto atípico registrado"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-FORECAST-006"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/spending-anomalies.api.test.ts
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
  - "un EDITOR registra un gasto de 304.00 BOB que la detección marcará como atípico"
  - "corre el trabajo diario"
expected_result:
  - "el gasto se registró con la misma respuesta y latencia que cualquier otro"
  - "su versión, su estado y sus asientos no cambian al marcarse"
  - "las cifras del Home y del plan del periodo son las mismas antes y después de marcarlo"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-015 — Marcar un gasto atípico no cambia la transacción ni sus asientos

## Intención

Verifica el scenario "Gasto atípico registrado" del requirement "La detección nunca bloquea ni modifica transacciones" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando un EDITOR registra un gasto de 304.00 BOB que la detección marcará como atípico
Y corre el trabajo diario
Entonces el gasto se registró con la misma respuesta y latencia que cualquier otro
Y su versión, su estado y sus asientos no cambian al marcarse
Y las cifras del Home y del plan del periodo son las mismas antes y después de marcarlo
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
