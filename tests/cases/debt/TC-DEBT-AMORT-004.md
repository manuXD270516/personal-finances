---
id: TC-DEBT-AMORT-004
title: 'La suma del principal de las cuotas es exactamente el principal'
spec: debt/amortization
related_specs: []
requirement: 'Redondeo HALF_EVEN y residuo en la última cuota'
scenario: 'Suma exacta del principal'
requirement_status: confirmed
fr: ['FR-DEBT-006']
nfr: []
invariants: ['INV-017']
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/amortization-calculator.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'rounding']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma del préstamo vehicular de 50000.00 BOB a 24 cuotas'
expected_result:
  - 'La suma del principal de las 24 cuotas es exactamente 50000.00 BOB y el saldo tras la cuota 24 es 0.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-004 — La suma del principal de las cuotas es exactamente el principal

## Intención

INV-017 sobre el caso del owner.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma del préstamo vehicular de 50000.00 BOB a 24 cuotas
Entonces la suma del principal de las 24 cuotas es exactamente 50000.00 BOB y el saldo tras la cuota 24 es 0.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
