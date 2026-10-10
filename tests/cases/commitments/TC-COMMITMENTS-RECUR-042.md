---
id: TC-COMMITMENTS-RECUR-042
title: 'El recorrido de una ocurrencia muestra generar, próxima y materializar con la edición como anotación'
spec: audit/lifecycle-timeline
related_specs: [commitments/recurrence-engine]
requirement: 'Recorrido de una ocurrencia recurrente'
scenario: 'Recorrido del internet de octubre'
requirement_status: confirmed
fr: ['FR-AUDIT-009', 'FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['lifecycle', 'recurrence']
error_code: null
preconditions:
  - 'Ocurrencia del Internet 2026-10-20 generada, DUE el 2026-10-17, editada a 210.00 BOB y aprobada el 2026-10-20'
input: {}
steps:
  - 'GET W/recurring/occurrences/{id}/lifecycle'
  - 'Omitir la ocurrencia ya materializada'
expected_result:
  - 'GENERATE (actor proceso), BECOME_DUE (proceso), MATERIALIZE (EDITOR) con el gasto enlazado; anotación EDIT 210.00 BOB'
  - 'Omitir ⇒ 409 INVALID_STATUS_TRANSITION'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-042 — El recorrido de una ocurrencia muestra generar, próxima y materializar con la edición como anotación

## Intención

D37 aplicado a la ocurrencia.

## Escenario

```gherkin
Dado la ocurrencia del "Internet" del 2026-10-20 editada y aprobada
Cuando el usuario consulta su recorrido
Entonces ve generar, pasar a próxima y materializar con la edición como anotación
```

## Notas

- Cubre el scenario "Omitir una ocurrencia materializada".
