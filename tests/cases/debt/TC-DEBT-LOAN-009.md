---
id: TC-DEBT-LOAN-009
title: 'Un desembolso fechado en un periodo cerrado se rechaza sin efectos'
spec: debt/loans
related_specs: ['planning/financial-periods']
requirement: 'Desembolso registrado como transacción'
scenario: 'Desembolso en un periodo cerrado'
requirement_status: provisional
fr: ['FR-DEBT-002']
nfr: []
invariants: ['INV-015']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'periods']
error_code: PERIOD_CLOSED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El periodo "2026-09" está cerrado y el EDITOR desembolsa un préstamo con fecha 2026-09-30'
expected_result:
  - 'Se rechaza con `PERIOD_CLOSED`, el préstamo sigue en borrador y no se crea ninguna transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-009 — Un desembolso fechado en un periodo cerrado se rechaza sin efectos

## Intención

Los periodos cerrados no cambian en silencio (INV-015).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el periodo "2026-09" está cerrado y el EDITOR desembolsa un préstamo con fecha 2026-09-30
Entonces se rechaza con `PERIOD_CLOSED`, el préstamo sigue en borrador y no se crea ninguna transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
