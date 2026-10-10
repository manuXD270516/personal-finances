---
id: TC-DEBT-AMORT-030
title: 'Un cambio de tasa sobre un préstamo custom se rechaza'
spec: debt/amortization
related_specs: []
requirement: 'El cronograma custom prevalece sobre el cálculo'
scenario: 'Cambio de tasa sobre un custom'
requirement_status: provisional
fr: ['FR-DEBT-005', 'FR-DEBT-009']
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
tags: ['amortization', 'custom']
error_code: LOAN_SCHEDULE_IS_CUSTOM
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un cambio de tasa en el préstamo con cronograma custom'
expected_result:
  - 'Se rechaza con `LOAN_SCHEDULE_IS_CUSTOM` y el cronograma no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-030 — Un cambio de tasa sobre un préstamo custom se rechaza

## Intención

Pregunta 3: los custom no se recalculan.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un cambio de tasa en el préstamo con cronograma custom
Entonces se rechaza con `LOAN_SCHEDULE_IS_CUSTOM` y el cronograma no cambia
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
