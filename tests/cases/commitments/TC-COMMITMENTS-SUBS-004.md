---
id: TC-COMMITMENTS-SUBS-004
title: 'Una suscripción cobrada en USDT desde una billetera USDT conserva la escala de USDT'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Registrar una suscripción con su definición recurrente'
scenario: 'Suscripción cobrada en USDT desde una billetera USDT'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012']
nfr: []
invariants: ['INV-001', 'INV-002']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/subscription.test.ts
  - packages/contexts/commitments/test/integration/pg-subscriptions.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'crypto']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Wallet USDT" (crypto_wallet, USDT, escala 6) activa'
  - 'Contraparte "VPN Pro" activa'
input:
  price: '5.000000 USDT'
  cycle: 'MONTHLY x1'
  firstRenewalOn: '2026-11-03'
  paymentAccount: 'Wallet USDT'
steps:
  - 'Registrar la suscripción'
expected_result:
  - 'Definición de 5.000000 USDT mensual en "Wallet USDT"'
  - 'Primer precio 5.000000 USDT desde 2026-11-03'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-004 — Una suscripción cobrada en USDT desde una billetera USDT conserva la escala de USDT

## Intención

Exit criterion: cobros en USDT modelados con su escala, sin conversión.

## Escenario

```gherkin
Cuando registro "VPN Pro" por 5.000000 USDT mensual con "Wallet USDT"
Entonces la definición es de 5.000000 USDT
  Y el primer precio es 5.000000 USDT desde 2026-11-03
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
