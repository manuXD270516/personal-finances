---
id: TC-DEBT-LOAN-044
title: 'Un principal con más decimales que la moneda se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Registrar un préstamo con sus condiciones'
scenario: 'Principal con escala inválida'
requirement_status: provisional
fr: ['FR-DEBT-001']
nfr: []
invariants: ['INV-001']
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'validation', 'scale']
error_code: AMOUNT_SCALE_EXCEEDED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un préstamo de 50000.005 BOB'
expected_result:
  - 'Se rechaza con `AMOUNT_SCALE_EXCEEDED` y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-044 — Un principal con más decimales que la moneda se rechaza

## Intención

Los montos del usuario nunca se redondean en silencio (docs/09 §12 regla 6).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un préstamo de 50000.005 BOB
Entonces se rechaza con `AMOUNT_SCALE_EXCEEDED` y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
