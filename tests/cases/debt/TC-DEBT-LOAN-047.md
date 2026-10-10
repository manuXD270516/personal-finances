---
id: TC-DEBT-LOAN-047
title: 'El prepago reduce la deuda y la comisión es gasto, con versión nueva'
spec: debt/loans
related_specs: []
requirement: 'Registrar un pago extraordinario'
scenario: 'Prepago con comisión'
requirement_status: provisional
fr: ['FR-DEBT-008']
nfr: []
invariants: ['INV-016', 'INV-004']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'prepayment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 12000.00 BOB tiene pagadas las cuotas 1 a 3 y el EDITOR registra el 2027-01-15 desde "Banco BOB" un pago extraordinario de 3000.00 BOB reduciendo el plazo con una comisión por prepago de 30.00 BOB'
expected_result:
  - '"Banco BOB" baja 3030.00 BOB, la deuda baja 3000.00 BOB a 6132.95 BOB y el gasto en "Comisiones de préstamo" es 30.00 BOB'
  - 'El cronograma vigente es la versión 2 con las cuotas 4 a 9'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-047 — El prepago reduce la deuda y la comisión es gasto, con versión nueva

## Intención

FR-DEBT-008: pago extraordinario como transacción y recálculo en la misma unidad de trabajo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 12000.00 BOB tiene pagadas las cuotas 1 a 3 y el EDITOR registra el 2027-01-15 desde "Banco BOB" un pago extraordinario de 3000.00 BOB reduciendo el plazo con una comisión por prepago de 30.00 BOB
Entonces "Banco BOB" baja 3030.00 BOB, la deuda baja 3000.00 BOB a 6132.95 BOB y el gasto en "Comisiones de préstamo" es 30.00 BOB
  Y el cronograma vigente es la versión 2 con las cuotas 4 a 9
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
