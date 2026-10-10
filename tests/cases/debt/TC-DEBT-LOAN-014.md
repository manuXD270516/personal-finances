---
id: TC-DEBT-LOAN-014
title: 'Un pago puede cubrir varias cuotas en orden'
spec: debt/loans
related_specs: []
requirement: 'Registrar el pago de cuotas con su desglose'
scenario: 'Un pago que cubre dos cuotas'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-016']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'payment', 'allocation']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un pago de 4684.04 BOB del préstamo sin cargos con las cuotas 1 y 2 sin pagar'
expected_result:
  - 'Las cuotas 1 y 2 quedan pagadas, la deuda baja 3743.56 BOB (1862.85 + 1880.71) y el interés registrado es 940.48 BOB (479.17 + 461.31)'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-014 — Un pago puede cubrir varias cuotas en orden

## Intención

La imputación recorre las cuotas en orden de número; un pago adelantado no debe quedar sin imputar.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un pago de 4684.04 BOB del préstamo sin cargos con las cuotas 1 y 2 sin pagar
Entonces las cuotas 1 y 2 quedan pagadas, la deuda baja 3743.56 BOB (1862.85 + 1880.71) y el interés registrado es 940.48 BOB (479.17 + 461.31)
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
