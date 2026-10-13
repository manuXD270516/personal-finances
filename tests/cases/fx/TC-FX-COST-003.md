---
id: TC-FX-COST-003
title: "Las conversiones sin referencia se excluyen de promedios y totales y se cuentan aparte"
spec: fx/conversion-pricing
related_specs: []
requirement: "Conversiones sin referencia excluidas y contadas aparte"
scenario: "Venta sin referencia"
requirement_status: confirmed
fr: ["FR-FX-011", "FR-FX-007"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/conversion-cost.queries.test.ts
  - packages/contexts/reporting/src/domain/conversion-cost.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "exclusion"]
error_code: null
preconditions:
  - "Grupo \"Binance P2P\" de TC-FX-COST-001"
  - "Venta de 20.000000 USDT por 238.00 BOB sin referencia; otra sin tasa cotizada"
input: {}
steps:
  - "Agregar el periodo"
expected_result:
  - "Promedios y totales del grupo iguales a TC-FX-COST-001"
  - "Excluidas: 1 NO_REFERENCE con 20.000000 USDT y 1 NO_QUOTED_RATE"
  - "Ningún spread estimado"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-003 — Las conversiones sin referencia se excluyen de promedios y totales y se cuentan aparte

## Intención

D247: la base es la referencia registrada; sin ella no hay spread (FR-FX-007).

## Escenario

```gherkin
Dado una venta sin referencia
Cuando se agrega
Entonces se cuenta aparte y no cambia los promedios
```

## Notas

