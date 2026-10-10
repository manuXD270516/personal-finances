---
id: TC-DEBT-CARD-018
title: 'Activar el plan con una transferencia recurrente activa hacia la tarjeta se rechaza'
spec: debt/credit-cards
related_specs: ['commitments/recurrence-engine']
requirement: 'Transferencias recurrentes existentes hacia la tarjeta'
scenario: 'Pago Visa ya cargado como transferencia'
requirement_status: provisional
fr: ['FR-DEBT-013', 'FR-COMMITMENTS-001']
nfr: []
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 4
tags: ['credit-cards', 'payment-plan', 'backward-compat']
error_code: CARD_PAYMENT_PLAN_CONFLICT
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Banco BOB" (bank, BOB, LIQUID) activa'
  - 'Transferencia recurrente del usuario "Pago Visa" 1450.00 BOB Banco BOB → Visa Oro BOB, día 6, activa'
input:
  register: 'Visa Oro con paymentPlan {source: Banco BOB}'
steps:
  - 'Registrar la tarjeta pidiendo el plan'
  - 'Terminar "Pago Visa" y activar el plan'
expected_result:
  - 'Tarjeta registrada sin plan, paymentPlanConflicts: ["Pago Visa"] (409 CARD_PAYMENT_PLAN_CONFLICT al activarlo)'
  - '"Pago Visa" sigue activa y su ocurrencia del 2026-11-06 espera 1450.00 BOB'
  - 'Tras terminarla, el plan queda activo desde el próximo vencimiento'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-018 — Activar el plan con una transferencia recurrente activa hacia la tarjeta se rechaza

## Intención

No romper las transferencias recurrentes cargadas según D116 ni contar dos veces el pago en Q4/Q8.

## Escenario

```gherkin
Dado "Pago Visa" activa hacia "Visa Oro BOB"
Cuando activo el plan de pago
Entonces se rechaza con CARD_PAYMENT_PLAN_CONFLICT
  Y "Pago Visa" sigue igual
```

## Notas

- Cubre "Plan tras terminar la transferencia del usuario".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
