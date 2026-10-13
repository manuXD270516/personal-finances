---
id: TC-FX-COST-008
title: "El spread alternativo contra la venta paralela del día no altera el spread contra la referencia"
spec: fx/conversion-pricing
related_specs: []
requirement: "Spread recalculado contra la compra o venta paralela del día"
scenario: "Venta comparada con la venta paralela"
requirement_status: confirmed
fr: ["FR-FX-011"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/conversion-cost.queries.test.ts
  - packages/contexts/reporting/src/domain/conversion-cost.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "could"]
error_code: null
preconditions:
  - "Venta de 100.000000 USDT a 11.90 con referencia 12.00"
  - "USDT/BOB PARALLEL_SELL 11.92 vigente al instante"
input: {"compareWith": "PARALLEL_SIDE"}
steps:
  - "Agregar con compareWith = PARALLEL_SIDE"
expected_result:
  - "Spread alternativo 0.1678 %"
  - "Spread contra la referencia 0.8333 % sin cambios"
  - "Una conversión sin tasa del lado correspondiente se excluye solo del alternativo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-008 — El spread alternativo contra la venta paralela del día no altera el spread contra la referencia

## Intención

D247: recalcular contra compra o venta paralela es Could.

## Escenario

```gherkin
Dado una venta a 11.90 y venta paralela 11.92
Cuando se pide el alternativo
Entonces es 0.1678 %
```

## Notas

