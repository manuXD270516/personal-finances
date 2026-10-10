---
id: TC-REPORTING-UPCOMING-011
title: "El consolidado de los próximos pagos se redondea HALF_EVEN solo al presentar"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Valoración de los próximos pagos en la moneda de reporte"
scenario: "Redondeo solo al presentar"
requirement_status: confirmed
fr: ["FR-REPORTING-016","FR-FX-006"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-001","INV-003"]
priority: high
type: unit
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/upcoming-valuation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: null
preconditions:
  - "Dos ocurrencias de 3.33 USD cada una en la ventana"
  - "USD/BOB vigente 12.005"
input: {"rate":"12.005","amounts":["3.33","3.33"]}
steps:
  - "Consultar los próximos pagos"
expected_result:
  - "Consolidado = 79.95 BOB (6.66 × 12.005 = 79.9533)"
  - "No 79.96 BOB (suma de 39.98 por ítem)"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-011 — El consolidado de los próximos pagos se redondea HALF_EVEN solo al presentar

## Intención

Agregar por moneda antes de convertir y redondear al final, como el resto del Home (docs/14 §5).

## Escenario

```gherkin
Dados dos pagos de 3.33 USD y USD/BOB 12.005
Cuando consulto los próximos pagos
Entonces el consolidado es 79.95 BOB y no 79.96 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
