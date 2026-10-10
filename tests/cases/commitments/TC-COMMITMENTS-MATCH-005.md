---
id: TC-COMMITMENTS-MATCH-005
title: 'Una coincidencia exacta de un gasto importado no vincula nada sin confirmación'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'El matching nunca vincula sin confirmación'
scenario: 'Coincidencia exacta no se vincula sola'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010', 'FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/matching.test.tsx
  - packages/contexts/commitments/src/application/matching.service.test.ts
  - packages/contexts/commitments/src/domain/matching/occurrence-matcher.test.ts
status: automated
regression_suite: true
phase: 3
tags: ['matching', 'safety']
error_code: null
preconditions:
  - 'Ocurrencia del Internet 199.00 BOB, contraparte Tigo, vence 2026-10-20'
input:
  transaction: 'EXPENSE 199.00 BOB Banco BOB Tigo 2026-10-20 origin IMPORT'
steps:
  - 'Procesar TransactionCreated.v1'
expected_result:
  - 'Sugerencia score 100.00 HIGH'
  - 'Ocurrencia sigue DUE sin transactionId'
  - 'Ningún RecurringOccurrenceMaterialized.v1 emitido'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-005 — Una coincidencia exacta de un gasto importado no vincula nada sin confirmación

## Intención

Garantía Must: nunca vincular solo (FR-COMMITMENTS-010 "sugerido").

## Escenario

```gherkin
Dado la ocurrencia del "Internet" del 2026-10-20
Cuando se importa un gasto idéntico
Entonces se crea una sugerencia de confianza alta
  Y la ocurrencia sigue sin resolver hasta que el usuario confirme
```

## Notas

- Complementa la propiedad TC-COMMITMENTS-MATCH-014.
