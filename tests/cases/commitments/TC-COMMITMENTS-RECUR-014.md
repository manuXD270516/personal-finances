---
id: TC-COMMITMENTS-RECUR-014
title: 'Propiedad: re-ejecutar o solapar ventanas de generación nunca duplica ocurrencias'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Generación idempotente de ocurrencias'
scenario: 'Re-ejecutar la generación'
requirement_status: provisional
fr: ['FR-COMMITMENTS-006']
nfr: []
invariants: ['INV-013']
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 3
tags: ['recurrence', 'idempotency', 'pbt']
error_code: null
preconditions:
  - 'Generadores fast-check de reglas (9 cadencias, intervalo 1..12, días 1..31 y -1, RRULE del subconjunto) y ventanas'
input:
  runs: '100 en PR, 10000 nightly'
steps:
  - '∀ regla, ∀ ventanas w1, w2: generar w1, w2 y w1 otra vez sobre el mismo estado'
expected_result:
  - 'Sin fechas nominales duplicadas'
  - 'generate(w) dos veces = una vez'
  - 'generate(w1) ∪ generate(w2) = generate(w1 ∪ w2)'
  - 'Caso fijo: Alquiler mensual desde 2026-10-05 hasta 2027-01-07 ejecutado 5 veces ⇒ 4 ocurrencias'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-014 — Propiedad: re-ejecutar o solapar ventanas de generación nunca duplica ocurrencias

## Intención

Exit criteria de Phase 3 (docs/24 §5.3): generación re-ejecutada N veces sin duplicados.

## Escenario

```gherkin
Dado cualquier regla y ventanas solapadas
Cuando la generación se ejecuta varias veces
Entonces cada fecha nominal tiene una sola ocurrencia
```

## Notas

- Oráculo de docs/09 INV-013.
