---
id: TC-REPORTING-REPORTS-014
title: "Cada reporte declara su política de conversión y valora los flujos con la tasa de su fecha"
spec: reporting/financial-reports
related_specs: ["fx/market-rates"]
requirement: "Política de conversión explícita en cada reporte"
scenario: "Gasto en dólares a la tasa de su fecha"
requirement_status: confirmed
fr: ["FR-REPORTING-011"]
nfr: []
invariants: ["INV-012", "INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/reports/reports.test.tsx
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["conversion-policy"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Gasto 50.00 USD el 2026-10-15; USD/BOB 10.00 al cierre del 2026-10-15 y 10.50 al 2026-10-31"
input: {}
steps:
  - "Calcular el reporte de 2026-10"
expected_result:
  - "El gasto se valora en 500.00 BOB"
  - "meta.conversion.policy = TRANSACTION_DATE con la tasa USD/BOB 10.00, su tipo, su fuente y su fecha"
  - "El redondeo HALF_EVEN se aplica solo al presentar"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-014 — Cada reporte declara su política de conversión y valora los flujos con la tasa de su fecha

## Intención

FR-REPORTING-011, D109: la política de conversión es visible y es la misma que el Home y Planning.

## Escenario

```gherkin
Dado un gasto de 50.00 USD el 2026-10-15 a 10.00
Cuando se pide el reporte de 2026-10
Entonces se valora en 500.00 BOB
  Y declara la política de tasa de la fecha con la tasa usada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
