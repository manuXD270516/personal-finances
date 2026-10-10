---
id: TC-DEBT-AMORT-032
title: 'Prepago reduciendo la cuota: mismas fechas y cuota menor'
spec: debt/amortization
related_specs: []
requirement: 'Pago extraordinario reduciendo la cuota'
scenario: 'Prepago de 3000.00 reduciendo la cuota'
requirement_status: provisional
fr: ['FR-DEBT-008']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'prepayment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El mismo préstamo con principal pendiente 9132.95 BOB recibe el 2027-01-15 un pago extraordinario de 3000.00 BOB reduciendo la cuota'
expected_result:
  - 'La versión 2 tiene las cuotas 4 a 12 de 715.96 BOB con la cuota 12 de 715.99 BOB y la suma de su principal es 6132.95 BOB'
  - 'El interés restante baja de 462.71 BOB a 310.72 BOB (ahorro 151.99 BOB)'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-032 — Prepago reduciendo la cuota: mismas fechas y cuota menor

## Intención

FR-DEBT-008: reducir cuota y su ahorro de interés.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el mismo préstamo con principal pendiente 9132.95 BOB recibe el 2027-01-15 un pago extraordinario de 3000.00 BOB reduciendo la cuota
Entonces la versión 2 tiene las cuotas 4 a 12 de 715.96 BOB con la cuota 12 de 715.99 BOB y la suma de su principal es 6132.95 BOB
  Y el interés restante baja de 462.71 BOB a 310.72 BOB (ahorro 151.99 BOB)
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
