---
id: TC-DEBT-AMORT-022
title: 'En el alemán la última cuota absorbe el residuo del principal'
spec: debt/amortization
related_specs: []
requirement: 'Sistema alemán de capital constante'
scenario: 'Principal no divisible'
requirement_status: provisional
fr: ['FR-DEBT-004', 'FR-DEBT-006']
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
tags: ['amortization', 'german', 'rounding']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma alemán de 10000.00 BOB al 0.00 % en 3 cuotas'
expected_result:
  - 'El principal de las cuotas es 3333.33, 3333.33 y 3333.34 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-022 — En el alemán la última cuota absorbe el residuo del principal

## Intención

INV-017 con un principal que no se divide exacto.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma alemán de 10000.00 BOB al 0.00 % en 3 cuotas
Entonces el principal de las cuotas es 3333.33, 3333.33 y 3333.34 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
