---
id: TC-REPORTING-INSIGHT-003
title: "Una factura pendiente que vence en el periodo entra en la proyección"
spec: reporting/predictive-insights
related_specs: []
requirement: "Pagos conocidos en la proyección"
scenario: "Una factura pendiente que lleva al exceso"
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
  - "\"Servicios\" tiene máximo 500.00 BOB, gastado variable 100.00 BOB y una ocurrencia pendiente de \"Luz\" de 300.00 BOB con vencimiento 2026-11-20"
  - "se calcula el riesgo el 2026-11-10"
expected_result:
  - "la proyección es 600.00 BOB (100.00 + 300.00 + 200.00) y el riesgo es LIKELY"
  - "knownPending es 300.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-003 — Una factura pendiente que vence en el periodo entra en la proyección

## Intención

Verifica el scenario "Una factura pendiente que lleva al exceso" del requirement "Pagos conocidos en la proyección" de `reporting/predictive-insights` (FR-REPORTING-020, FR-COMMITMENTS-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Servicios" tiene máximo 500.00 BOB, gastado variable 100.00 BOB y una ocurrencia pendiente de "Luz" de 300.00 BOB con vencimiento 2026-11-20
Y se calcula el riesgo el 2026-11-10
Entonces la proyección es 600.00 BOB (100.00 + 300.00 + 200.00) y el riesgo es LIKELY
Y knownPending es 300.00 BOB
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
