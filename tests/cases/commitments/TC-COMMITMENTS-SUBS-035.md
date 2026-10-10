---
id: TC-COMMITMENTS-SUBS-035
title: 'Sin tasa al generar el cargo de una suscripción indexada el cargo queda sin monto, nunca 1:1'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Precio en una moneda distinta de la cuenta de pago'
scenario: 'Sin tasa al generar el cargo'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-012', 'FR-COMMITMENTS-004']
nfr: []
invariants: ['INV-002']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'fx', 'indexed-amount']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuenta "Visa BOB" (credit_card, BOB) activa'
  - '"Streamly" 10.99 USD pagada con "Visa BOB"'
  - 'Ninguna tasa USD/BOB dentro de la ventana de vigencia al generar el cargo del 2026-12-15'
input:
  occurrenceDate: '2026-12-15'
steps:
  - 'Generar las ocurrencias de la definición (motor)'
expected_result:
  - 'La ocurrencia del 2026-12-15 no tiene monto esperado y exige el monto real al confirmarla'
  - 'No existe una ocurrencia de 10.99 BOB'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-035 — Sin tasa al generar el cargo de una suscripción indexada el cargo queda sin monto, nunca 1:1

## Intención

docs/31 D29/D53: nunca suponer 1:1 cuando falta la tasa.

## Escenario

```gherkin
Dado que no hay tasa USD/BOB vigente
Cuando se genera el cargo del 2026-12-15
Entonces queda sin monto
  Y no es de 10.99 BOB
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
