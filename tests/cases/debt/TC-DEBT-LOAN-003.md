---
id: TC-DEBT-LOAN-003
title: 'Un sistema distinto del francés se rechaza mientras no esté habilitado'
spec: debt/loans
related_specs: []
requirement: 'Registrar un préstamo con sus condiciones'
scenario: 'Sistema alemán aún no disponible'
requirement_status: provisional
fr: ['FR-DEBT-001', 'FR-DEBT-004']
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'validation']
error_code: LOAN_METHOD_NOT_AVAILABLE
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un préstamo de 12000.00 BOB con sistema alemán antes de que ese sistema esté habilitado'
expected_result:
  - 'Se rechaza con `LOAN_METHOD_NOT_AVAILABLE` y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-003 — Un sistema distinto del francés se rechaza mientras no esté habilitado

## Intención

add-loans solo implementa el sistema francés; aceptar otro sistema sin su cálculo crearía cronogramas incorrectos. Se depreca al aplicar add-loan-amortization-advanced (lo reemplaza TC-DEBT-LOAN-046).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un préstamo de 12000.00 BOB con sistema alemán antes de que ese sistema esté habilitado
Entonces se rechaza con `LOAN_METHOD_NOT_AVAILABLE` y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
