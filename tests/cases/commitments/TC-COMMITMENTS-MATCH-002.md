---
id: TC-COMMITMENTS-MATCH-002
title: 'Una transacción sin ocurrencias compatibles en su cuenta no genera sugerencias'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Sugerencia de coincidencia para una transacción registrada'
scenario: 'Transacción sin ocurrencia compatible'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/match-suggestions.api.test.ts
  - packages/contexts/commitments/src/application/matching.service.test.ts
  - packages/contexts/commitments/src/domain/matching/occurrence-matcher.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['matching']
error_code: null
preconditions:
  - 'Sin ocurrencias de la cuenta Efectivo entre 2026-10-14 y 2026-10-24'
input:
  transaction: 'EXPENSE 45.90 BOB Efectivo 2026-10-19'
steps:
  - 'OccurrenceMatcher.candidates'
expected_result:
  - 'Lista vacía; ninguna sugerencia'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-002 — Una transacción sin ocurrencias compatibles en su cuenta no genera sugerencias

## Intención

Los filtros duros evitan ruido.

## Escenario

```gherkin
Cuando el usuario registra un gasto de 45.90 BOB en "Efectivo"
Entonces no se crea ninguna sugerencia
```

## Notas

- Incluye casos de tipo incompatible: un REFUND o un ADJUSTMENT nunca son candidatos.
