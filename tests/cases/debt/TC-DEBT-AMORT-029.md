---
id: TC-DEBT-AMORT-029
title: 'Los pagos se imputan contra las cuotas custom'
spec: debt/amortization
related_specs: []
requirement: 'El cronograma custom prevalece sobre el cálculo'
scenario: 'Pago contra la cuota custom'
requirement_status: provisional
fr: ['FR-DEBT-005', 'FR-DEBT-007']
nfr: []
invariants: ['INV-016']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'custom', 'payment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 1000.00 BOB con cronograma custom recibe el pago de 410.00 BOB de la cuota 1'
expected_result:
  - 'Se imputan 400.00 BOB a principal y 10.00 BOB a interés según la cuota custom'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-029 — Los pagos se imputan contra las cuotas custom

## Intención

El custom prevalece sobre el cálculo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 1000.00 BOB con cronograma custom recibe el pago de 410.00 BOB de la cuota 1
Entonces se imputan 400.00 BOB a principal y 10.00 BOB a interés según la cuota custom
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
