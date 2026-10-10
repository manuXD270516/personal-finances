---
id: TC-DEBT-LOAN-048
title: 'Un prepago por todo el pendiente salda el préstamo'
spec: debt/loans
related_specs: []
requirement: 'Registrar un pago extraordinario'
scenario: 'Prepago que salda el préstamo'
requirement_status: provisional
fr: ['FR-DEBT-008']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'prepayment', 'paid-off']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El principal pendiente es 9132.95 BOB y el EDITOR registra un pago extraordinario de 9132.95 BOB'
expected_result:
  - 'La deuda queda en 0.00 BOB, el préstamo queda saldado y su compromiso terminado'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-048 — Un prepago por todo el pendiente salda el préstamo

## Intención

El saldado por prepago cierra el compromiso.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el principal pendiente es 9132.95 BOB y el EDITOR registra un pago extraordinario de 9132.95 BOB
Entonces la deuda queda en 0.00 BOB, el préstamo queda saldado y su compromiso terminado
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
