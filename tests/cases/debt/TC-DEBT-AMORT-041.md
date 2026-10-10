---
id: TC-DEBT-AMORT-041
title: 'Simulación de un extra mensual con ahorro y fecha de fin'
spec: debt/amortization
related_specs: []
requirement: 'Simulador de pagos extra en un préstamo'
scenario: 'Extra recurrente'
requirement_status: provisional
fr: ['FR-DEBT-010']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'simulator']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El VIEWER simula el mismo préstamo con 200.00 BOB extra cada mes desde la cuota 1'
expected_result:
  - 'El interés total es 670.30 BOB, la fecha de fin es 2027-09-15 y el ahorro es 123.93 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-041 — Simulación de un extra mensual con ahorro y fecha de fin

## Intención

FR-DEBT-010: escenario de pago extra recurrente.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el VIEWER simula el mismo préstamo con 200.00 BOB extra cada mes desde la cuota 1
Entonces el interés total es 670.30 BOB, la fecha de fin es 2027-09-15 y el ahorro es 123.93 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
