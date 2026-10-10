---
id: TC-COMMITMENTS-RECUR-011
title: 'Montos inconsistentes con el tipo o con escala excedida se rechazan'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Tipos de monto'
scenario: 'Rango invertido'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-004']
nfr: []
invariants: ['INV-001', 'INV-002']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/domain/definition.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'amount']
error_code: RECURRING_INVALID_AMOUNT
preconditions:
  - 'Cuenta "Banco BOB"'
input:
  a: 'MIN_MAX 200.00..150.00 BOB'
  b: 'FIXED sin monto'
  c: 'FIXED 10.005 BOB'
  d: 'FIXED -5.00 BOB'
steps:
  - 'Construir cada AmountSpec'
expected_result:
  - 'Todos se rechazan con RECURRING_INVALID_AMOUNT'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-011 — Montos inconsistentes con el tipo o con escala excedida se rechazan

## Intención

Dinero sin float y con la escala de la moneda (INV-001/002).

## Escenario

```gherkin
Cuando se crea un gasto MIN_MAX de 200.00 a 150.00 BOB
Entonces se rechaza con RECURRING_INVALID_AMOUNT
```

## Notas

