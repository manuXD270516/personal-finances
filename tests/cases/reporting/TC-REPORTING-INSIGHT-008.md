---
id: TC-REPORTING-INSIGHT-008
title: "La factura pendiente adelanta el exceso al día siguiente de su vencimiento"
spec: reporting/predictive-insights
related_specs: []
requirement: "Fecha estimada del exceso"
scenario: "Exceso por la factura pendiente"
requirement_status: provisional
fr: ["FR-REPORTING-020"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "\"Servicios\" tiene máximo 500.00 BOB, gastado variable 100.00 BOB y la ocurrencia de \"Luz\" de 300.00 BOB vence el 2026-11-20"
  - "se calcula el riesgo el 2026-11-10"
expected_result:
  - "la fecha estimada del exceso es 2026-11-21 (el 2026-11-20 suma 500.00, sin superar el tope, y el 2026-11-21 suma 510.00)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-008 — La factura pendiente adelanta el exceso al día siguiente de su vencimiento

## Intención

Verifica el scenario "Exceso por la factura pendiente" del requirement "Fecha estimada del exceso" de `reporting/predictive-insights` (FR-REPORTING-020).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Servicios" tiene máximo 500.00 BOB, gastado variable 100.00 BOB y la ocurrencia de "Luz" de 300.00 BOB vence el 2026-11-20
Y se calcula el riesgo el 2026-11-10
Entonces la fecha estimada del exceso es 2026-11-21 (el 2026-11-20 suma 500.00, sin superar el tope, y el 2026-11-21 suma 510.00)
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
