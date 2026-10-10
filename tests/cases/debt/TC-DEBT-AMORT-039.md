---
id: TC-DEBT-AMORT-039
title: 'Una vigencia anterior al primer periodo no pagado se rechaza'
spec: debt/amortization
related_specs: []
requirement: 'Cambio de tasa variable con vigencia'
scenario: 'Vigencia en un periodo ya pagado'
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
error_code: LOAN_CHANGE_DATE_INVALID
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra 15.00 % vigente desde el 2027-02-01 con las cuotas 1 a 6 pagadas'
expected_result:
  - 'Se rechaza con `LOAN_CHANGE_DATE_INVALID` y el cronograma no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-039 — Una vigencia anterior al primer periodo no pagado se rechaza

## Intención

Las cuotas pagadas no se recalculan.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra 15.00 % vigente desde el 2027-02-01 con las cuotas 1 a 6 pagadas
Entonces se rechaza con `LOAN_CHANGE_DATE_INVALID` y el cronograma no cambia
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
