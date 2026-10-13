---
id: TC-FX-COST-007
title: "Una conversión de un par sin la moneda de reporte se valora con la tasa del instante o se excluye sin 1:1"
spec: fx/conversion-pricing
related_specs: []
requirement: "Análisis de costo de conversiones por canal, par y periodo"
scenario: null
requirement_status: confirmed
fr: ["FR-FX-011", "FR-FX-006"]
nfr: []
invariants: ["INV-012"]
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/conversion-cost.queries.test.ts
  - packages/contexts/reporting/src/domain/conversion-cost.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "valuation", "crypto"]
error_code: null
preconditions:
  - "Swap de 1000.000000 USDT por 0.01600000 BTC con referencia BTC/USDT y fee de red de 15.000000 TRX"
  - "USDT/BOB 12.00 vigente al instante; sin tasa TRX/BOB"
input: {}
steps:
  - "Agregar el periodo con y sin tasa USDT/BOB vigente"
expected_result:
  - "Con USDT/BOB, el monto convertido se valora en BOB con 12.00 del instante de la conversión"
  - "El fee en TRX sin tasa deja el costo del grupo marcado incompleto, sin usar 1:1"
  - "Sin USDT/BOB en la ventana, la conversión se excluye con NO_REPORTING_RATE"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-007 — Una conversión de un par sin la moneda de reporte se valora con la tasa del instante o se excluye sin 1:1

## Intención

Los pares cripto (change 38) también se convierten; nunca se inventa una tasa (RISK-017).

## Escenario

```gherkin
Dado un swap USDT→BTC
Cuando no hay tasa a la moneda de reporte
Entonces se excluye con NO_REPORTING_RATE
```

## Notas

