---
id: TC-PLANNING-ACTUAL-005
title: 'Una tasa registrada después no recalcula el gastado convertido'
spec: planning/budgets
related_specs: ['fx/market-rates']
requirement: 'Gasto en otra moneda convertido con la tasa de su fecha'
scenario: 'Tasa posterior no recalcula'
requirement_status: provisional
fr: ['FR-PLANNING-023']
nfr: []
invariants: ['INV-012']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['budgets', 'actual', 'multi-currency', 'immutability']
error_code: null
preconditions:
  - 'Estado final de TC-PLANNING-ACTUAL-004 (gastado 341.00 BOB)'
input:
  laterRate: 'USD/BOB PARALLEL 12.40 vigente 2026-11-20'
steps:
  - 'Registrar la tasa del 2026-11-20'
  - 'Consultar el plan'
expected_result:
  - 'El gastado de "Restaurantes" sigue siendo 341.00 BOB'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-ACTUAL-005 — Una tasa registrada después no recalcula el gastado convertido

## Intención

INV-012: un flujo histórico nunca se recalcula con tasas posteriores.

## Escenario

```gherkin
Dado el gastado de 341.00 BOB con la tasa 12.05
Cuando se registra USD/BOB 12.40 el 2026-11-20
Entonces el gastado sigue siendo 341.00 BOB
```

## Notas

