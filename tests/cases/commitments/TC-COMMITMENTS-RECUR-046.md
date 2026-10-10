---
id: TC-COMMITMENTS-RECUR-046
title: 'Aprobar antes del vencimiento usa la fecha de hoy como fecha de negocio'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Aprobar una ocurrencia crea su transacción'
scenario: 'Pago anticipado del alquiler'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'materialize']
error_code: null
preconditions:
  - 'Hoy 2026-10-30; ocurrencia SCHEDULED del Alquiler 2026-11-05 3500.00 BOB'
input:
  businessDate: '(ausente)'
steps:
  - 'Aprobar sin fecha'
expected_result:
  - 'Gasto de 3500.00 BOB con fecha 2026-10-30'
  - 'Ocurrencia MATERIALIZED'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-046 — Aprobar antes del vencimiento usa la fecha de hoy como fecha de negocio

## Intención

Fecha por omisión = min(vencimiento, hoy) (design decisión 11).

## Escenario

```gherkin
Dado hoy 2026-10-30
Cuando el EDITOR aprueba sin fecha la ocurrencia del 2026-11-05
Entonces se crea un gasto con fecha 2026-10-30
```

## Notas

