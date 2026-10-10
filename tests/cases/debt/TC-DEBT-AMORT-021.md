---
id: TC-DEBT-AMORT-021
title: 'Cronograma alemán de capital constante con cuota decreciente'
spec: debt/amortization
related_specs: []
requirement: 'Sistema alemán de capital constante'
scenario: 'Alemán a 12 cuotas'
requirement_status: provisional
fr: ['FR-DEBT-004']
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
tags: ['amortization', 'german']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma alemán de 12000.00 BOB al 12.00 % anual, 30/360, mensual, 12 cuotas desde el 2026-11-15'
expected_result:
  - 'Cada cuota tiene 1000.00 BOB de principal y las cuotas son 1120.00, 1110.00, … hasta 1010.00 BOB'
  - 'El interés total es 780.00 BOB y la suma del principal es 12000.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-021 — Cronograma alemán de capital constante con cuota decreciente

## Intención

FR-DEBT-004: sistema alemán con principal constante.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma alemán de 12000.00 BOB al 12.00 % anual, 30/360, mensual, 12 cuotas desde el 2026-11-15
Entonces cada cuota tiene 1000.00 BOB de principal y las cuotas son 1120.00, 1110.00, … hasta 1010.00 BOB
  Y el interés total es 780.00 BOB y la suma del principal es 12000.00 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
