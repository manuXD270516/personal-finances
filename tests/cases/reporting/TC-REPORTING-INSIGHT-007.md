---
id: TC-REPORTING-INSIGHT-007
title: "La fecha estimada del exceso de Restaurantes es el 22 de noviembre"
spec: reporting/predictive-insights
related_specs: []
requirement: "Fecha estimada del exceso"
scenario: "Exceso el día 22"
requirement_status: provisional
fr: ["FR-REPORTING-020"]
nfr: []
invariants: ["INV-001"]
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
  - "\"Restaurantes\" tiene máximo 600.00 BOB y gastado 280.00 BOB el 2026-11-10 en un periodo de 30 días"
expected_result:
  - "la fecha estimada del exceso es 2026-11-22 (280.00 + 28.00 × 12 = 616.00 y el 2026-11-21 sería 588.00)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-007 — La fecha estimada del exceso de Restaurantes es el 22 de noviembre

## Intención

Verifica el scenario "Exceso el día 22" del requirement "Fecha estimada del exceso" de `reporting/predictive-insights` (FR-REPORTING-020).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Restaurantes" tiene máximo 600.00 BOB y gastado 280.00 BOB el 2026-11-10 en un periodo de 30 días
Entonces la fecha estimada del exceso es 2026-11-22 (280.00 + 28.00 × 12 = 616.00 y el 2026-11-21 sería 588.00)
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
