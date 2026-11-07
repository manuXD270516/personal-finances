---
id: TC-REPORTING-REPORTS-046
title: "La evolución de suscripciones informa el costo mensual al cierre con altas, bajas y cambios de precio"
spec: reporting/financial-reports
related_specs: ["commitments/subscriptions"]
requirement: "Reporte de evolución de suscripciones"
scenario: "Aumento, alta y baja"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - packages/contexts/commitments/src/application/recurring-cost.queries.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["subscriptions"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Música 25.00 BOB y video 69.00 BOB activas al cierre de julio"
  - "Música a 30.00 BOB el 2026-08-01; alta de 50.00 BOB el 2026-09-10; baja de video el 2026-10-05"
input: {}
steps:
  - "Calcular la evolución de 2026-07 a 2026-10"
expected_result:
  - "Costo mensual al cierre 94.00, 99.00, 149.00 y 80.00 BOB"
  - "Eventos: aumento 25.00 → 30.00 BOB (ago), alta (sep), baja (oct)"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-046 — La evolución de suscripciones informa el costo mensual al cierre con altas, bajas y cambios de precio

## Intención

Reporte 12: altas, bajas y aumentos visibles en el tiempo.

## Escenario

```gherkin
Dado las suscripciones de julio a octubre
Cuando se pide su evolución
Entonces el costo mensual al cierre es 94.00, 99.00, 149.00 y 80.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
