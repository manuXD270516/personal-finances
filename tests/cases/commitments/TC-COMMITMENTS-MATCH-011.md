---
id: TC-COMMITMENTS-MATCH-011
title: 'Al crear una definición después del pago se sugiere la transacción ya registrada'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Sugerencias para ocurrencias nuevas'
scenario: 'Definición creada después del pago'
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
status: automated
regression_suite: false
phase: 3
tags: ['matching', 'backfill']
error_code: null
preconditions:
  - 'Gasto de 320.00 BOB en Banco BOB del 2026-10-10 sin vincular'
  - 'Hoy 2026-10-14'
input:
  definition: 'Seguro auto EXPENSE FIXED 320.00 BOB MONTHLY desde 2026-10-10 en Banco BOB'
steps:
  - 'Crear la definición'
  - 'Procesar OccurrencesGenerated.v1 en commitments.match-backfill'
expected_result:
  - 'Sugerencia PROPOSED entre el gasto del 2026-10-10 y la ocurrencia del 2026-10-10'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-011 — Al crear una definición después del pago se sugiere la transacción ya registrada

## Intención

Backfill: insumo de SM-07 y de la limpieza del comprometido.

## Escenario

```gherkin
Dado un gasto de 320.00 BOB del 2026-10-10
Cuando el 2026-10-14 el EDITOR crea "Seguro auto" mensual desde 2026-10-10
Entonces se sugiere la coincidencia con la ocurrencia del 2026-10-10
```

## Notas

- Usa TransactionLinkQuery.listLinkCandidates.
