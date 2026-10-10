---
id: TC-DEBT-LOAN-028
title: 'Un préstamo con pagos vigentes no se cancela'
spec: debt/loans
related_specs: []
requirement: 'Préstamo saldado y préstamo cancelado'
scenario: 'Cancelar un préstamo con pagos'
requirement_status: provisional
fr: ['FR-DEBT-001']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'cancel']
error_code: LOAN_HAS_PAYMENTS
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR cancela el "Préstamo vehicular" con la cuota 1 pagada'
expected_result:
  - 'Se rechaza con `LOAN_HAS_PAYMENTS` y el préstamo sigue activo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-028 — Un préstamo con pagos vigentes no se cancela

## Intención

Cancelar con pagos dejaría transacciones de pago huérfanas.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR cancela el "Préstamo vehicular" con la cuota 1 pagada
Entonces se rechaza con `LOAN_HAS_PAYMENTS` y el préstamo sigue activo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
