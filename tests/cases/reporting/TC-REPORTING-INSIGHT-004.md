---
id: TC-REPORTING-INSIGHT-004
title: "Lo pagado por una ocurrencia no se extrapola"
spec: reporting/predictive-insights
related_specs: []
requirement: "Pagos conocidos en la proyección"
scenario: "Un pago fijo no se extrapola"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-COMMITMENTS-010"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/budget-risk.queries.test.ts
  - packages/contexts/reporting/src/domain/budget-overrun-projector.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "\"Servicios\" tiene máximo 600.00 BOB y gastado 300.00 BOB, de los cuales 250.00 BOB son el pago de la ocurrencia \"Internet\" del 2026-11-02"
  - "se calcula el riesgo el 2026-11-10"
expected_result:
  - "el gastado variable es 50.00 BOB, la proyección es 400.00 BOB y el riesgo es UNLIKELY"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-004 — Lo pagado por una ocurrencia no se extrapola

## Intención

Verifica el scenario "Un pago fijo no se extrapola" del requirement "Pagos conocidos en la proyección" de `reporting/predictive-insights` (FR-REPORTING-020, FR-COMMITMENTS-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Servicios" tiene máximo 600.00 BOB y gastado 300.00 BOB, de los cuales 250.00 BOB son el pago de la ocurrencia "Internet" del 2026-11-02
Y se calcula el riesgo el 2026-11-10
Entonces el gastado variable es 50.00 BOB, la proyección es 400.00 BOB y el riesgo es UNLIKELY
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
