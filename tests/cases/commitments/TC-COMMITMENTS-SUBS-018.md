---
id: TC-COMMITMENTS-SUBS-018
title: 'Corregir un precio tipeado mal lo reemplaza conservando la entrada original'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Corrección de un precio registrado por error'
scenario: 'Monto tipeado mal'
requirement_status: provisional
fr: ['FR-COMMITMENTS-013']
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['subscriptions', 'price-history', 'supersede']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" con entrada errónea 129.90 USD desde 2027-03-15'
input:
  supersede: '129.90 USD → 12.99 USD'
  effectiveFrom: '2027-03-15'
steps:
  - 'POST …/prices/{priceId}/supersede'
  - 'Intentar reemplazar otra vez la entrada de 129.90'
expected_result:
  - 'Precio vigente desde 2027-03-15: 12.99 USD'
  - 'Historial conserva 129.90 USD marcada como reemplazada por 12.99 USD'
  - 'Segundo reemplazo ⇒ INVALID_STATUS_TRANSITION'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-018 — Corregir un precio tipeado mal lo reemplaza conservando la entrada original

## Intención

Inmutabilidad sin perder la posibilidad de corregir errores (patrón supersede de FX).

## Escenario

```gherkin
Dado 129.90 USD desde 2027-03-15 por error
Cuando la corrijo a 12.99 USD
Entonces el precio vigente es 12.99 USD
  Y la entrada de 129.90 USD sigue en el historial como reemplazada
```

## Notas

- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
