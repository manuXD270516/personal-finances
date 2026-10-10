---
id: TC-DEBT-LOAN-038
title: 'El comprometido suma la cuota sin doble conteo tras pagarla'
spec: commitments/recurrence-engine
related_specs: ['debt/loans', 'reporting/cash-flow-calendar']
requirement: 'Cuotas de préstamo en el comprometido y en los próximos pagos'
scenario: 'Comprometido con alquiler y cuota'
requirement_status: provisional
fr: ['FR-COMMITMENTS-011', 'FR-DEBT-011']
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
tags: ['commitments', 'loans', 'q4']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El periodo "2026-11" tiene sin resolver el "Alquiler" de 3500.00 BOB del 2026-11-05 y la cuota 1 del "Préstamo vehicular" de 2342.02 BOB del 2026-11-15'
expected_result:
  - 'El comprometido de noviembre en BOB es 5842.02 BOB'
  - 'Al registrarse el pago de la cuota 1 el comprometido baja a 3500.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-038 — El comprometido suma la cuota sin doble conteo tras pagarla

## Intención

Q4 incluye cuotas de préstamo como egreso; resuelta, deja de sumar.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el periodo "2026-11" tiene sin resolver el "Alquiler" de 3500.00 BOB del 2026-11-05 y la cuota 1 del "Préstamo vehicular" de 2342.02 BOB del 2026-11-15
Entonces el comprometido de noviembre en BOB es 5842.02 BOB
  Y al registrarse el pago de la cuota 1 el comprometido baja a 3500.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
