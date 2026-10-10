---
id: TC-COMMITMENTS-RECUR-052
title: 'El comprometido multi-moneda se consolida en BOB con la tasa de valoración del Home'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Total comprometido del periodo financiero'
scenario: 'Comprometido multi-moneda'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-011']
nfr: []
invariants: ['INV-001', 'INV-012']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/committed.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'committed', 'fx']
error_code: null
preconditions:
  - 'Escenario de TC-COMMITMENTS-RECUR-036 + Spotify 5.99 USD del 2026-10-15'
  - 'Tasa de valoración vigente 6.96 BOB por USD'
input: {}
steps:
  - 'GetCommitted(periodo 2026-10)'
expected_result:
  - 'byCurrency: 779.00 BOB y 5.99 USD'
  - 'consolidated 820.69 BOB complete true (5.99 × 6.96 = 41.6904 → 41.69 HALF_EVEN al presentar)'
  - 'ratesUsed con la tasa usada'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-052 — El comprometido multi-moneda se consolida en BOB con la tasa de valoración del Home

## Intención

Misma valoración que el Home (D29, D53, FlowValuation).

## Escenario

```gherkin
Dado además "Spotify" 5.99 USD sin resolver y la tasa 6.96 BOB por USD
Cuando se calcula el comprometido
Entonces el consolidado es 820.69 BOB completo
```

## Notas

