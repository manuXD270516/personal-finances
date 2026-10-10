---
id: TC-COMMITMENTS-RECUR-030
title: 'Vincular con una transacción de otra cuenta se rechaza por incompatibilidad'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Marcar pagada vinculando una transacción existente'
scenario: 'Cuenta distinta'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'link']
error_code: OCCURRENCE_LINK_MISMATCH
preconditions:
  - 'Ocurrencia del Internet en Banco BOB'
  - 'Gasto de 199.00 BOB en Efectivo'
input: {}
steps:
  - 'POST …/link con el gasto de Efectivo'
expected_result:
  - '422 OCCURRENCE_LINK_MISMATCH con details.reasons [ACCOUNT]'
  - 'La ocurrencia no cambia'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-030 — Vincular con una transacción de otra cuenta se rechaza por incompatibilidad

## Intención

Compatibilidad estricta de cuenta, tipo y moneda (design decisión 12).

## Escenario

```gherkin
Dado la ocurrencia del "Internet" de la cuenta "Banco BOB"
Cuando el usuario la vincula con un gasto de "Efectivo"
Entonces se rechaza con OCCURRENCE_LINK_MISMATCH
```

## Notas

