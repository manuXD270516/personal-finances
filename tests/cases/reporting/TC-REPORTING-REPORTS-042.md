---
id: TC-REPORTING-REPORTS-042
title: "Las comisiones se clasifican en un solo tipo cada una y suman el total del mes"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de comisiones"
scenario: "Comisiones de octubre"
requirement_status: confirmed
fr: ["FR-REPORTING-008"]
nfr: []
invariants: ["INV-016"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - packages/contexts/transactions/test/integration/pg-nominal-portions.int.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["fees"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "2026-10: comisión de conversión 2.00 BOB, de transferencia 5.00 BOB, cuota con 320.00 BOB de interés y 80.00 BOB de cargos, 15.00 BOB en \"Comisiones bancarias\""
input: {}
steps:
  - "Calcular el reporte de comisiones de 2026-10"
expected_result:
  - "Conversión 2.00, transferencia 5.00, préstamos 400.00, categorías de comisiones 15.00 BOB"
  - "Total 422.00 BOB"
  - "Ninguna porción aparece en dos tipos"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-042 — Las comisiones se clasifican en un solo tipo cada una y suman el total del mes

## Intención

Reporte 14: "¿cuánto pierdo en comisiones?" sin doble conteo.

## Escenario

```gherkin
Dado las comisiones de octubre
Cuando se pide el reporte de comisiones
Entonces el total es 422.00 BOB repartido en cuatro tipos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
