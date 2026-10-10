---
id: TC-DEBT-LOAN-052
title: 'Reducir la cuota actualiza el comprometido del periodo'
spec: debt/loans
related_specs: ['commitments/recurrence-engine']
requirement: 'Compromisos actualizados con la nueva versión del cronograma'
scenario: 'Cuota reducida en el comprometido'
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
  - 'El prepago reduciendo la cuota deja cuotas de 715.96 BOB y el periodo "2027-02" tiene la cuota 4 del 2027-02-15'
expected_result:
  - 'El comprometido de febrero de 2027 incluye 715.96 BOB por esa cuota'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-052 — Reducir la cuota actualiza el comprometido del periodo

## Intención

Q4 debe reflejar la cuota nueva.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el prepago reduciendo la cuota deja cuotas de 715.96 BOB y el periodo "2027-02" tiene la cuota 4 del 2027-02-15
Entonces el comprometido de febrero de 2027 incluye 715.96 BOB por esa cuota
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
