---
id: TC-DEBT-LOAN-002
title: 'La primera cuota anterior al desembolso se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Registrar un préstamo con sus condiciones'
scenario: 'Primera cuota antes del desembolso'
requirement_status: provisional
fr: ['FR-DEBT-001']
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
error_code: VALIDATION_FAILED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un préstamo con desembolso el 2026-10-15 y primera cuota el 2026-10-10'
expected_result:
  - 'Se rechaza con `VALIDATION_FAILED` y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-002 — La primera cuota anterior al desembolso se rechaza

## Intención

Fechas incoherentes producirían un primer periodo negativo y un interés absurdo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un préstamo con desembolso el 2026-10-15 y primera cuota el 2026-10-10
Entonces se rechaza con `VALIDATION_FAILED` y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
