---
id: TC-COMMITMENTS-SUBS-026
title: 'Sin tasa para una moneda el costo total queda incompleto con la parte sin convertir'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Costo mensualizado y anualizado en moneda base'
scenario: 'Moneda sin tasa'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-015']
nfr: []
invariants: ['INV-002']
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'cost', 'fx']
error_code: null
preconditions:
  - 'Mismo workspace y suscripciones de TC-COMMITMENTS-SUBS-025'
  - 'Sin ninguna tasa USDT/BOB dentro de la ventana de vigencia'
input:
  endpoint: 'GET W/subscriptions/cost-summary'
steps:
  - 'Consultar el costo'
expected_result:
  - 'Total mensual 439.36 BOB, complete false'
  - 'unconverted: 5.000000 USDT'
  - 'Nunca 5.00 BOB (sin 1:1)'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-026 — Sin tasa para una moneda el costo total queda incompleto con la parte sin convertir

## Intención

docs/31 D29/D53: sin tasa se informa sin convertir, nunca 1:1.

## Escenario

```gherkin
Dado que no hay tasa USDT/BOB vigente
Cuando consulto el costo
Entonces el total es 439.36 BOB incompleto
  Y 5.000000 USDT quedan sin convertir
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
