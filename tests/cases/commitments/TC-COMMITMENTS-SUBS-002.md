---
id: TC-COMMITMENTS-SUBS-002
title: 'Registrar una suscripción con contraparte archivada se rechaza sin crear nada'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Registrar una suscripción con su definición recurrente'
scenario: 'Contraparte archivada'
requirement_status: provisional
fr: ['FR-COMMITMENTS-012']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'validation']
error_code: 'COUNTERPARTY_ARCHIVED'
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Contraparte "OldTV" archivada'
  - 'Cuenta "Visa USD" (credit_card, USD) activa'
input:
  provider: 'OldTV'
  price: '7.99 USD'
  cycle: 'MONTHLY x1'
  firstRenewalOn: '2026-11-01'
steps:
  - 'Registrar la suscripción como EDITOR'
expected_result:
  - 'Rechazo COUNTERPARTY_ARCHIVED'
  - 'No existe suscripción ni definición recurrente nuevas'
  - 'Sin entrada de auditoría'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-002 — Registrar una suscripción con contraparte archivada se rechaza sin crear nada

## Intención

La suscripción y su definición se crean atómicamente; una validación fallida no deja definiciones huérfanas.

## Escenario

```gherkin
Dado la contraparte "OldTV" archivada
Cuando registro una suscripción con "OldTV"
Entonces se rechaza con COUNTERPARTY_ARCHIVED
  Y no se crea ninguna suscripción ni definición
```

## Notas

- Variantes del mismo test: precio 0.00 USD ⇒ AMOUNT_NOT_POSITIVE (scenario "Precio cero"); cuenta archivada ⇒ ACCOUNT_ARCHIVED; 10.999 USD ⇒ AMOUNT_SCALE_EXCEEDED.
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
