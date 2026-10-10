---
id: TC-DEBT-AMORT-038
title: 'Un préstamo de tasa fija no admite cambios de tasa'
spec: debt/amortization
related_specs: []
requirement: 'Cambio de tasa variable con vigencia'
scenario: 'Tasa fija'
requirement_status: provisional
fr: ['FR-DEBT-009']
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
tags: ['amortization', 'variable-rate', 'validation']
error_code: LOAN_RATE_FIXED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un cambio de tasa en el "Préstamo vehicular" de tasa fija'
expected_result:
  - 'Se rechaza con `LOAN_RATE_FIXED` y el cronograma no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-038 — Un préstamo de tasa fija no admite cambios de tasa

## Intención

El tipo de tasa (FR-DEBT-001) limita el flujo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un cambio de tasa en el "Préstamo vehicular" de tasa fija
Entonces se rechaza con `LOAN_RATE_FIXED` y el cronograma no cambia
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
