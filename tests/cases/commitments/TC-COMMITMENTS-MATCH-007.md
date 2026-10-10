---
id: TC-COMMITMENTS-MATCH-007
title: 'Una sugerencia cuya ocurrencia se resolvió por otra vía queda expirada y no se puede confirmar'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Confirmar una sugerencia'
scenario: 'Sugerencia ya resuelta por otra vía'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/match-suggestions.api.test.ts
  - packages/contexts/commitments/src/application/matching.service.test.ts
  - packages/contexts/commitments/src/domain/matching/match-suggestion.test.ts
  - packages/contexts/commitments/test/integration/pg-matching.int.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['matching', 'expire']
error_code: MATCH_SUGGESTION_NOT_PENDING
preconditions:
  - 'Sugerencia PROPOSED del Internet 2026-10-20'
input: {}
steps:
  - 'Aprobar la ocurrencia creando otro gasto'
  - 'Confirmar la sugerencia'
expected_result:
  - 'Al aprobar, la sugerencia pasa a EXPIRED (OCCURRENCE_RESOLVED) en la misma UoW'
  - 'Confirmar ⇒ 409 MATCH_SUGGESTION_NOT_PENDING; nada cambia'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-007 — Una sugerencia cuya ocurrencia se resolvió por otra vía queda expirada y no se puede confirmar

## Intención

Expiración síncrona: la bandeja nunca muestra sugerencias obsoletas.

## Escenario

```gherkin
Dado que el EDITOR aprobó la ocurrencia del "Internet" creando otro gasto
Cuando confirma la sugerencia anterior
Entonces se rechaza con MATCH_SUGGESTION_NOT_PENDING
```

## Notas

