---
id: TC-DEBT-LOAN-050
title: 'Anular el prepago restituye el cronograma previo como versión nueva'
spec: debt/loans
related_specs: []
requirement: 'Anular un pago extraordinario'
scenario: 'Prepago anulado'
requirement_status: provisional
fr: ['FR-DEBT-008']
nfr: []
invariants: ['INV-008', 'INV-016']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'prepayment', 'void', 'versioning']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR anula el pago extraordinario de 3000.00 BOB que creó la versión 2'
expected_result:
  - 'La deuda vuelve a 9132.95 BOB y la versión 3 rige con las cuotas 4 a 12 de 1066.19 BOB (la 12 de 1066.14 BOB)'
  - 'Las versiones 1 y 2 siguen consultables como reemplazadas'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-050 — Anular el prepago restituye el cronograma previo como versión nueva

## Intención

Las versiones nunca se borran ni se reactivan; se agrega una nueva.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR anula el pago extraordinario de 3000.00 BOB que creó la versión 2
Entonces la deuda vuelve a 9132.95 BOB y la versión 3 rige con las cuotas 4 a 12 de 1066.19 BOB (la 12 de 1066.14 BOB)
  Y las versiones 1 y 2 siguen consultables como reemplazadas
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
