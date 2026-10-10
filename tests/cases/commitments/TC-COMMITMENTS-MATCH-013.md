---
id: TC-COMMITMENTS-MATCH-013
title: 'Una ocurrencia reinstaurada al reanudar recibe la sugerencia del pago ya registrado'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Sugerencias para ocurrencias nuevas'
scenario: 'Ocurrencia reinstaurada al reanudar'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching', 'backfill']
error_code: null
preconditions:
  - 'Natación FIXED 150.00 BOB, pausada; ocurrencia 2026-12-02 CANCELLED (PAUSED)'
  - 'Gasto de 150.00 BOB en la misma cuenta del 2026-12-01 sin vincular'
  - 'Hoy 2026-12-01'
input: {}
steps:
  - 'Reanudar la definición (REINSTATE de 2026-12-02)'
  - 'Procesar OccurrencesGenerated.v1 en commitments.match-backfill'
expected_result:
  - 'Sugerencia PROPOSED entre el gasto del 2026-12-01 y la ocurrencia del 2026-12-02 (dateDeltaDays 1)'
  - 'La ocurrencia sigue SCHEDULED o DUE hasta que el usuario confirme'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-013 — Una ocurrencia reinstaurada al reanudar recibe la sugerencia del pago ya registrado

## Intención

El backfill cubre reinstauraciones, no solo ocurrencias nuevas; sirve a SM-07 al vincular pagos ya registrados.

## Escenario

```gherkin
Dado la "Natación" pausada y un gasto de 150.00 BOB del 2026-12-01
Cuando se reanuda el 2026-12-01 y se reinstaura la ocurrencia del 2026-12-02
Entonces se sugiere la coincidencia entre ese gasto y esa ocurrencia
```

## Notas

- SM-07 lo mide add-upcoming-payments con ResolvedOccurrencesQuery (design decisión 9).
