---
id: TC-COMMITMENTS-RECUR-037
title: 'Sin tasa el comprometido consolidado queda incompleto e informa las ocurrencias sin monto'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Total comprometido del periodo financiero'
scenario: 'Sin tasa y con montos variables'
requirement_status: provisional
fr: ['FR-COMMITMENTS-011']
nfr: []
invariants: ['INV-012']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'committed', 'fx']
error_code: null
preconditions:
  - 'Escenario de TC-COMMITMENTS-RECUR-036 + Spotify 5.99 USD del 2026-10-15 + Compra mayorista VARIABLE'
  - 'Sin tasa de valoración USD/BOB'
input: {}
steps:
  - 'GetCommitted(periodo 2026-10)'
expected_result:
  - 'consolidated 779.00 BOB complete false'
  - 'unconverted [5.99 USD]'
  - 'withoutAmountCount 1'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-037 — Sin tasa el comprometido consolidado queda incompleto e informa las ocurrencias sin monto

## Intención

Nunca 1:1 sin tasa (D82, misma valoración del Home).

## Escenario

```gherkin
Dado que no hay tasa de valoración para USD
Cuando se calcula el comprometido
Entonces el consolidado es 779.00 BOB incompleto con 5.99 USD sin convertir
  Y informa 1 ocurrencia sin monto
```

## Notas

