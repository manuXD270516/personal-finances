---
id: TC-DEBT-LOAN-022
title: 'La cuota del préstamo suma al comprometido del periodo y aparece en próximos pagos'
spec: debt/loans
related_specs: ['commitments/recurrence-engine', 'reporting/cash-flow-calendar']
requirement: 'Cuotas como compromisos recurrentes'
scenario: 'Cuota en el comprometido de noviembre'
requirement_status: provisional
fr: ['FR-DEBT-011', 'FR-COMMITMENTS-011']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'commitments', 'q4', 'q8']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Hoy es 2026-11-02, el periodo "2026-11" va del 2026-11-01 al 2026-11-30 y la única ocurrencia sin resolver es la cuota 1 del "Préstamo vehicular" del 2026-11-15 por 2342.02 BOB'
expected_result:
  - 'El comprometido de noviembre en BOB es 2342.02 BOB'
  - 'Los próximos pagos de 30 días listan "Préstamo vehicular — cuota 1" del 2026-11-15 por 2342.02 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-022 — La cuota del préstamo suma al comprometido del periodo y aparece en próximos pagos

## Intención

FR-DEBT-011: las cuotas alimentan Q4 y Q8.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando hoy es 2026-11-02, el periodo "2026-11" va del 2026-11-01 al 2026-11-30 y la única ocurrencia sin resolver es la cuota 1 del "Préstamo vehicular" del 2026-11-15 por 2342.02 BOB
Entonces el comprometido de noviembre en BOB es 2342.02 BOB
  Y los próximos pagos de 30 días listan "Préstamo vehicular — cuota 1" del 2026-11-15 por 2342.02 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
