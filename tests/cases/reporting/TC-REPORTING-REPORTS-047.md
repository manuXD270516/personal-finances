---
id: TC-REPORTING-REPORTS-047
title: "El reporte de conversiones lista la tasa efectiva frente a la de referencia y el costo mensual del análisis de costo"
spec: reporting/financial-reports
related_specs: ["fx/conversion-pricing"]
requirement: "Reporte de conversiones de moneda y cripto"
scenario: "Octubre con dos ventas por Binance P2P"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-FX-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["conversions"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "2026-10: venta de 100.000000 USDT a 11.90 y de 300.000000 USDT a 11.94 con referencia 12.00; la segunda con comisión 2.00 BOB"
  - "Una conversión sin referencia"
input: {}
steps:
  - "Calcular el reporte de conversiones de 2026-10"
expected_result:
  - "Puntos 11.90/12.00 y 11.94/12.00"
  - "Costo de 2026-10 = 30.00 BOB (igual al análisis de costo)"
  - "La conversión sin referencia se lista sin punto de comparación y sin estimación"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-047 — El reporte de conversiones lista la tasa efectiva frente a la de referencia y el costo mensual del análisis de costo

## Intención

Reporte 13 reutiliza el cálculo aprobado en Phase 5 (D244–D247).

## Escenario

```gherkin
Dado dos ventas por Binance P2P en octubre
Cuando se pide el reporte de conversiones
Entonces lista dos puntos y un costo de 30.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
