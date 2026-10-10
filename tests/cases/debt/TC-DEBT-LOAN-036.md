---
id: TC-DEBT-LOAN-036
title: 'LOAN_PAYMENT sigue reservado para la API de recurrentes'
spec: commitments/recurrence-engine
related_specs: ['debt/loans']
requirement: 'Cuotas de préstamo administradas por el contexto de deudas'
scenario: 'Cuota de préstamo creada a mano'
requirement_status: provisional
fr: ['FR-DEBT-011', 'FR-COMMITMENTS-001']
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
tags: ['commitments', 'loans']
error_code: RECURRING_KIND_NOT_AVAILABLE
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR crea desde recurrentes una definición `LOAN_PAYMENT` de 1200.00 BOB mensual'
expected_result:
  - 'Se rechaza con `RECURRING_KIND_NOT_AVAILABLE` y no se crea nada'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-036 — LOAN_PAYMENT sigue reservado para la API de recurrentes

## Intención

D116 se mantiene para el usuario: solo el préstamo crea definiciones LOAN_PAYMENT.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR crea desde recurrentes una definición `LOAN_PAYMENT` de 1200.00 BOB mensual
Entonces se rechaza con `RECURRING_KIND_NOT_AVAILABLE` y no se crea nada
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
