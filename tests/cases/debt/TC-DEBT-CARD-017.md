---
id: TC-DEBT-CARD-017
title: 'El plan de pago estima antes del cierre, fija el monto después y omite sin saldo'
spec: debt/credit-cards
related_specs: ['commitments/recurrence-engine']
requirement: 'Pago de la tarjeta como compromiso administrado'
scenario: 'Monto exacto después del cierre'
requirement_status: confirmed
fr: ['FR-DEBT-013', 'FR-DEBT-014', 'FR-COMMITMENTS-011']
nfr: []
invariants: ['INV-013']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/payment-plan-expectation.test.ts
  - tests/e2e/specs/credit-cards.spec.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'payment-plan']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
  - 'Cuenta "Banco BOB" (bank, BOB, LIQUID) activa'
  - 'Plan de pago de "Visa Oro BOB" con origen "Banco BOB", NO_INTEREST, PENDING_APPROVAL'
input:
  today1: '2026-10-20'
  today2: '2026-10-26'
  policyMin: 'MINIMUM'
  usdBilled: '0.00 USD'
steps:
  - 'Consultar la ocurrencia del 2026-11-15 el 2026-10-20'
  - 'Emitir el 2026-10-26 y consultar'
  - 'Aprobar la ocurrencia'
  - 'Repetir con política MINIMUM'
  - 'Emitir "Visa Oro USD" con facturado 0.00 USD'
expected_result:
  - '2026-10-20: ESTIMATED 1120.50 BOB'
  - '2026-10-26: FIXED 1120.50 BOB; aprobar crea transferencia 1120.50 BOB Banco BOB → Visa Oro BOB'
  - 'MINIMUM: FIXED 56.02 BOB'
  - 'USD: ocurrencia omitida "sin saldo facturado", fuera del comprometido'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-017 — El plan de pago estima antes del cierre, fija el monto después y omite sin saldo

## Intención

El plan administrado es la fuente única del vencimiento en Q4/Q8 con el monto real del ciclo.

## Escenario

```gherkin
Dado el plan de pago de "Visa Oro BOB"
Cuando se emite el estado de cuenta de 1120.50 BOB
Entonces la ocurrencia del 2026-11-15 espera exactamente 1120.50 BOB
  Y al aprobarla se crea la transferencia
```

## Notas

- Cubre "Estimación antes del cierre", "Política de pago mínimo" y "Nada que pagar".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
