---
id: TC-COMMITMENTS-SUBS-001
title: 'Registrar una suscripción mensual en USD con tarjeta USD crea su definición y su primer precio'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Registrar una suscripción con su definición recurrente'
scenario: 'Suscripción mensual en USD pagada con una tarjeta en USD'
requirement_status: provisional
fr: ['FR-COMMITMENTS-012']
nfr: []
invariants: ['INV-001', 'INV-002', 'INV-029']
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'create']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa USD" (credit_card, USD) activa'
  - 'Contraparte "Streamly" activa'
input:
  provider: 'Streamly'
  plan: 'Premium'
  price: '10.99 USD'
  cycle: 'MONTHLY x1'
  firstRenewalOn: '2026-11-15'
  paymentAccount: 'Visa USD'
  materialization: 'PENDING_APPROVAL'
steps:
  - 'Registrar la suscripción como EDITOR'
expected_result:
  - 'Suscripción "Streamly" ACTIVE con próxima renovación 2026-11-15'
  - 'Definición recurrente EXPENSE mensual de 10.99 USD en "Visa USD", contraparte "Streamly", desde 2026-11-15, managedBy SUBSCRIPTION'
  - 'Historial de precios: una entrada 10.99 USD desde 2026-11-15 (INITIAL)'
  - 'Auditoría commitments.subscription.created en la misma transacción'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-001 — Registrar una suscripción mensual en USD con tarjeta USD crea su definición y su primer precio

## Intención

FR-COMMITMENTS-012: cada suscripción tiene una definición recurrente asociada creada en la misma operación; sin ella no habría cargos esperados ni Q4/Q8.

## Escenario

```gherkin
Dado la contraparte "Streamly" y la tarjeta "Visa USD"
Cuando registro "Streamly" Premium 10.99 USD mensual desde 2026-11-15
Entonces existe la suscripción activa con próxima renovación 2026-11-15
  Y su definición mensual de 10.99 USD en "Visa USD"
  Y el historial tiene 10.99 USD desde 2026-11-15
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
