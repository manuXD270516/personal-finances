---
id: TC-DEBT-CARD-029
title: 'CARD_PAYMENT solo en definiciones administradas por la tarjeta'
spec: commitments/recurrence-engine
related_specs: ['debt/credit-cards']
requirement: 'Pago de tarjeta administrado por la tarjeta'
scenario: 'Usuario crea un pago de tarjeta directamente'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-001', 'FR-DEBT-013', 'FR-DEBT-014']
nfr: []
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/commitments/src/application/card-payment.service.test.ts
  - packages/contexts/commitments/src/domain/card-payment.test.ts
  - packages/contexts/commitments/test/integration/pg-card-payment.int.test.ts
status: automated
regression_suite: true
phase: 4
tags: ['recurrence', 'card-payment']
error_code: RECURRING_KIND_NOT_AVAILABLE
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Cuenta "Banco BOB" (bank, BOB, LIQUID) activa'
  - 'Plan de pago activo; transferencia del usuario "Pago Visa"'
input:
  userCreate: 'CARD_PAYMENT 1450.00 BOB mensual'
  pause: 'pausar la definición del plan'
  manualTransfer: '1120.50 BOB el 2026-11-14'
steps:
  - 'Crear desde Pagos recurrentes una definición CARD_PAYMENT'
  - 'Pausar la definición del plan desde Pagos recurrentes'
  - 'Registrar una transferencia manual a la tarjeta'
  - 'Revisar "Pago Visa"'
expected_result:
  - '422 RECURRING_KIND_NOT_AVAILABLE sin crear nada'
  - '409 RECURRING_MANAGED_EXTERNALLY; sigue activa'
  - 'Sugerencia de vincular la transferencia con la ocurrencia del 2026-11-15 (sin vincular)'
  - '"Pago Visa" sigue TRANSFER, USER y editable'
  - 'La definición del plan es CARD_PAYMENT, managedBy DEBT, mensual día 15'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-029 — CARD_PAYMENT solo en definiciones administradas por la tarjeta

## Intención

Habilitar CARD_PAYMENT sin romper la reserva para el usuario ni las transferencias existentes.

## Escenario

```gherkin
Dado el motor de recurrencia con CARD_PAYMENT administrado
Cuando el EDITOR crea una definición CARD_PAYMENT desde recurrentes
Entonces se rechaza con RECURRING_KIND_NOT_AVAILABLE
```

## Notas

- Cubre "Plan de pago de la tarjeta", "Transferencia manual sugerida para el pago", "Pausar desde Pagos recurrentes" y "Transferencia del usuario intacta".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
