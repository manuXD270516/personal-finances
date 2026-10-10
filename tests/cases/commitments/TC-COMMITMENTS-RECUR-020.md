---
id: TC-COMMITMENTS-RECUR-020
title: 'La creación automática se rechaza para montos VARIABLE o MIN_MAX'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Modo creación automática'
scenario: 'Variable en creación automática'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-007']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'auto-create']
error_code: RECURRING_MODE_NOT_ALLOWED
preconditions:
  - 'Ninguna'
input:
  a: 'VARIABLE + AUTO_CREATE'
  b: 'MIN_MAX 100.00..180.00 BOB + AUTO_CREATE'
steps:
  - 'Crear cada definición'
expected_result:
  - 'Ambas se rechazan con RECURRING_MODE_NOT_ALLOWED'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-020 — La creación automática se rechaza para montos VARIABLE o MIN_MAX

## Intención

No se inventan montos al crear transacciones automáticamente.

## Escenario

```gherkin
Cuando el EDITOR crea un gasto VARIABLE en creación automática
Entonces se rechaza con RECURRING_MODE_NOT_ALLOWED
```

## Notas

