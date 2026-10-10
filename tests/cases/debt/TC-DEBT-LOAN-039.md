---
id: TC-DEBT-LOAN-039
title: 'El matching no sugiere vincular gastos manuales con cuotas de préstamo'
spec: commitments/recurrence-engine
related_specs: ['debt/loans']
requirement: 'Resolución de cuotas por el contexto de deudas'
scenario: 'Sin sugerencias para cuotas'
requirement_status: provisional
fr: ['FR-DEBT-011', 'FR-COMMITMENTS-008']
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
tags: ['commitments', 'matching', 'loans']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El usuario registra a mano un gasto de 2342.02 BOB en "Banco BOB" el 2026-11-15'
expected_result:
  - 'No se sugiere vincularlo con la ocurrencia de la cuota 1 del "Préstamo vehicular"'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-039 — El matching no sugiere vincular gastos manuales con cuotas de préstamo

## Intención

Solo el préstamo resuelve sus ocurrencias (N7); una sugerencia mezclaría un gasto con un pago de deuda.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el usuario registra a mano un gasto de 2342.02 BOB en "Banco BOB" el 2026-11-15
Entonces no se sugiere vincularlo con la ocurrencia de la cuota 1 del "Préstamo vehicular"
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
