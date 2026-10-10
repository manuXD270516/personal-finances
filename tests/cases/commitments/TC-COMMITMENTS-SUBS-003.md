---
id: TC-COMMITMENTS-SUBS-003
title: 'Una suscripción en USD pagada con tarjeta BOB estima cada cargo en BOB con la tasa paralela'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Precio en una moneda distinta de la cuenta de pago'
scenario: 'USD pagado con una tarjeta en BOB'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-COMMITMENTS-004']
nfr: []
invariants: ['INV-001', 'INV-002', 'INV-012']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'fx', 'indexed-amount']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa BOB" (credit_card, BOB) activa'
  - 'Tasa paralela USD/BOB 9.80 del provider de tasas vigente el 2026-11-15'
  - 'Contraparte "Streamly" activa'
input:
  price: '10.99 USD'
  cycle: 'MONTHLY x1'
  firstRenewalOn: '2026-11-15'
  paymentAccount: 'Visa BOB'
steps:
  - 'Registrar la suscripción'
  - 'Generar las ocurrencias de la definición (motor)'
expected_result:
  - 'El precio de la suscripción es 10.99 USD'
  - 'La ocurrencia del 2026-11-15 es ESTIMATED de 107.70 BOB (10.99 × 9.80 = 107.702, HALF_EVEN) en "Visa BOB"'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-003 — Una suscripción en USD pagada con tarjeta BOB estima cada cargo en BOB con la tasa paralela

## Intención

Exit criterion de Phase 3: suscripciones en USD cobradas en tarjeta BOB. FR-TRANSACTIONS-004 obliga al gasto en la moneda de la cuenta; el precio se conserva en USD y el cargo se estima con la tasa de valoración.

## Escenario

```gherkin
Dado la tasa paralela USD/BOB 9.80
Cuando registro "Streamly" por 10.99 USD con "Visa BOB"
Entonces el precio es 10.99 USD
  Y el cargo esperado del 2026-11-15 es 107.70 BOB estimado
```

## Notas

- Depende de N3 de add-recurrence-engine (monto indexado).
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
