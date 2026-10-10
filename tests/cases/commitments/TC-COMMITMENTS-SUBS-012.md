---
id: TC-COMMITMENTS-SUBS-012
title: 'El historial de precios es append-only: una entrada no se modifica ni se borra'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Historial de precios inmutable con vigencia'
scenario: 'Intento de editar una entrada'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-013']
nfr: []
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/domain/subscription/price-history.test.ts
  - packages/contexts/commitments/test/integration/pg-subscriptions.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'price-history', 'immutability']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Streamly" con 10.99 USD desde 2026-11-15 y 12.99 USD desde 2027-03-15'
input:
  attempts: ['UPDATE amount de la entrada 10.99', 'DELETE de la entrada 10.99']
steps:
  - 'Intentar UPDATE y DELETE con el rol pf_app'
  - 'Consultar el precio vigente el 2027-02-28 y el 2027-03-15'
expected_result:
  - 'Ambos intentos fallan (forbid_mutation / sin grant)'
  - 'Precio vigente 10.99 USD el 2027-02-28 y 12.99 USD el 2027-03-15'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-012 — El historial de precios es append-only: una entrada no se modifica ni se borra

## Intención

FR-COMMITMENTS-013: historial inmutable con vigencia; la base de la detección y del costo.

## Escenario

```gherkin
Dado el historial 10.99 USD desde 2026-11-15 y 12.99 USD desde 2027-03-15
Cuando intento cambiar la primera entrada
Entonces la operación falla
  Y el precio vigente el 2027-02-28 es 10.99 USD
```

## Notas

- Cubre también el scenario "Precio vigente por fecha".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
