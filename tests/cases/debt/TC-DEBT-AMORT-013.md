---
id: TC-DEBT-AMORT-013
title: 'Las condiciones financieras de un préstamo activo no se editan'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma fijado como versión inmutable'
scenario: 'Cambiar la tasa de un préstamo activo'
requirement_status: confirmed
fr: ['FR-DEBT-003']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/debt/src/domain/loan.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'versioning']
error_code: LOAN_TERMS_LOCKED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR edita la tasa del "Préstamo vehicular" activo de 11.50 % a 10.00 %'
expected_result:
  - 'Se rechaza con `LOAN_TERMS_LOCKED` y el cronograma versión 1 no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-013 — Las condiciones financieras de un préstamo activo no se editan

## Intención

El cronograma fijado es inmutable; los cambios de tasa van por el flujo de tasa variable del change avanzado.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR edita la tasa del "Préstamo vehicular" activo de 11.50 % a 10.00 %
Entonces se rechaza con `LOAN_TERMS_LOCKED` y el cronograma versión 1 no cambia
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
