---
id: TC-COMMITMENTS-RECUR-038
title: 'Los próximos 7 días listan atrasadas primero y excluyen vencimientos posteriores'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Lista de próximos pagos'
scenario: 'Próximos 7 días'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-011']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'upcoming', 'q8']
error_code: null
preconditions:
  - 'Hoy 2026-10-17'
  - 'Luz OVERDUE 2026-10-15, Internet 2026-10-20, Gimnasio 2026-10-28'
input:
  days: '7'
steps:
  - 'GET W/recurring/occurrences?days=7'
expected_result:
  - '[Luz (OVERDUE), Internet] en ese orden'
  - 'Sin Gimnasio'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-038 — Los próximos 7 días listan atrasadas primero y excluyen vencimientos posteriores

## Intención

FR-COMMITMENTS-011 / Q8: lista de próximos pagos.

## Escenario

```gherkin
Dado hoy 2026-10-17
Cuando se piden los próximos 7 días
Entonces la lista contiene la "Luz" atrasada y el "Internet"
  Y no contiene el "Gimnasio"
```

## Notas

- El mismo resultado lo entrega UpcomingCommitmentsQuery para Reporting.
