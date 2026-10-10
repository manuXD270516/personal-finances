---
id: TC-DEBT-LOAN-051
title: 'Reducir el plazo actualiza y cancela ocurrencias de cuotas'
spec: debt/loans
related_specs: ['commitments/recurrence-engine']
requirement: 'Compromisos actualizados con la nueva versión del cronograma'
scenario: 'Plazo reducido en los próximos pagos'
requirement_status: provisional
fr: ['FR-DEBT-011', 'FR-DEBT-008']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'commitments', 'prepayment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El prepago reduciendo el plazo deja las cuotas 4 a 9 con la 9 del 2027-07-15 de 1017.22 BOB'
expected_result:
  - 'La ocurrencia del 2027-07-15 espera 1017.22 BOB y no queda ninguna ocurrencia sin resolver del préstamo después del 2027-07-15'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-051 — Reducir el plazo actualiza y cancela ocurrencias de cuotas

## Intención

Q8 no debe mostrar cuotas que ya no existen.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el prepago reduciendo el plazo deja las cuotas 4 a 9 con la 9 del 2027-07-15 de 1017.22 BOB
Entonces la ocurrencia del 2027-07-15 espera 1017.22 BOB y no queda ninguna ocurrencia sin resolver del préstamo después del 2027-07-15
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
