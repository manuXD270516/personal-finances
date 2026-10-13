---
id: TC-FX-COST-004
title: "El análisis agrupa por periodo financiero por defecto y por mes calendario si se pide"
spec: fx/conversion-pricing
related_specs: ["planning/financial-periods"]
requirement: "Periodo financiero o mes calendario en el análisis de costo"
scenario: "Mes financiero que empieza el día 25"
requirement_status: provisional
fr: ["FR-FX-011", "FR-PLANNING-001"]
nfr: []
invariants: []
priority: medium
type: unit
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "period", "timezone"]
error_code: null
preconditions:
  - "Mes financiero que empieza el día 25; zona America/La_Paz"
  - "Conversión con fecha de negocio 2026-10-27 ejecutada el 2026-10-28T02:30:00Z (22:30 del 27 en La Paz)"
input: {"grouping": ["FINANCIAL_PERIOD", "CALENDAR_MONTH"]}
steps:
  - "Consultar con cada agrupación"
expected_result:
  - "Por periodo financiero: periodo del 2026-10-25 al 2026-11-24"
  - "Por mes calendario: octubre de 2026"
  - "La asignación usa la fecha de negocio en la zona del workspace, no la UTC"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-004 — El análisis agrupa por periodo financiero por defecto y por mes calendario si se pide

## Intención

D246 y RISK-020: periodos según el día de inicio y la zona del workspace.

## Escenario

```gherkin
Dado el mes financiero desde el día 25
Cuando se agrupa una conversión del 2026-10-27
Entonces va al periodo del 25 de octubre o a octubre según la opción
```

## Notas

