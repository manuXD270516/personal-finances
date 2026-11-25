---
id: TC-FORECAST-ANOMALY-018
title: "Descartar un gasto atípico lo saca de los abiertos y queda auditado"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Descartar y restaurar un gasto atípico"
scenario: "Descarte de un falso positivo"
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
  - "el EDITOR descarta el gasto atípico de 304.00 BOB con reason EXPECTED_ONE_OFF"
  - "repite el descarte"
expected_result:
  - "las dos respuestas son 204"
  - "el gasto deja de figurar entre los abiertos y figura entre los descartados con quien lo descartó y la fecha"
  - "hay un solo registro de auditoría DISMISS"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-018 — Descartar un gasto atípico lo saca de los abiertos y queda auditado

## Intención

Verifica el scenario "Descarte de un falso positivo" del requirement "Descartar y restaurar un gasto atípico" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el EDITOR descarta el gasto atípico de 304.00 BOB con reason EXPECTED_ONE_OFF
Y repite el descarte
Entonces las dos respuestas son 204
Y el gasto deja de figurar entre los abiertos y figura entre los descartados con quien lo descartó y la fecha
Y hay un solo registro de auditoría DISMISS
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
