---
id: TC-DEBT-LOAN-045
title: 'Cancelar un préstamo activo sin pagos anula el desembolso y termina el compromiso'
spec: debt/loans
related_specs: []
requirement: 'Préstamo saldado y préstamo cancelado'
scenario: 'Cancelar un desembolso registrado por error'
requirement_status: provisional
fr: ['FR-DEBT-002', 'FR-DEBT-011']
nfr: []
invariants: ['INV-008']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'cancel']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR cancela el "Préstamo vehicular" activo sin pagos con motivo "duplicado"'
expected_result:
  - 'La transacción de desembolso queda anulada con su reversa, la cuenta del préstamo adeuda 0.00 BOB, el préstamo queda cancelado y su compromiso terminado sin ocurrencias pendientes'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-045 — Cancelar un préstamo activo sin pagos anula el desembolso y termina el compromiso

## Intención

Un desembolso duplicado debe poder deshacerse por reversa sin dejar compromisos pendientes.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR cancela el "Préstamo vehicular" activo sin pagos con motivo "duplicado"
Entonces la transacción de desembolso queda anulada con su reversa, la cuenta del préstamo adeuda 0.00 BOB, el préstamo queda cancelado y su compromiso terminado sin ocurrencias pendientes
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
