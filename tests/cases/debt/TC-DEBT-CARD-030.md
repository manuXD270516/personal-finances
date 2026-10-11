---
id: TC-DEBT-CARD-030
title: 'El administrador fija el monto esperado de una ocurrencia no resuelta'
spec: commitments/recurrence-engine
related_specs: ['debt/credit-cards']
requirement: 'Monto esperado fijado por el administrador'
scenario: 'De estimación a monto exacto'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008', 'FR-DEBT-013']
nfr: []
invariants: ['INV-013', 'INV-029']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/card-payment.service.test.ts
  - packages/contexts/commitments/src/application/events.contract.test.ts
  - packages/contexts/commitments/test/integration/pg-card-payment.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['recurrence', 'managed']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Ocurrencia del 2026-11-15 ESTIMATED 1120.50 BOB'
input:
  expectation: 'FIXED 1120.50 BOB'
  resolved: 'ocurrencia vinculada; recálculo 1165.50 BOB'
steps:
  - 'Fijar la expectativa desde Debt'
  - 'Recalcular con la ocurrencia ya vinculada'
expected_result:
  - 'FIXED 1120.50 BOB, fecha nominal 2026-11-15, hecho de ocurrencia editada, auditoría de proceso'
  - 'Ocurrencia resuelta sin cambios'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-030 — El administrador fija el monto esperado de una ocurrencia no resuelta

## Intención

El puerto administrado nunca cambia ocurrencias resueltas.

## Escenario

```gherkin
Dado la ocurrencia estimada en 1120.50 BOB
Cuando la tarjeta emite el estado de cuenta
Entonces la ocurrencia espera exactamente 1120.50 BOB
```

## Notas

- Cubre "Ocurrencia ya pagada". Coordinar con el requirement equivalente de add-loans.
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
