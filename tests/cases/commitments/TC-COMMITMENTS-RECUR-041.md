---
id: TC-COMMITMENTS-RECUR-041
title: 'El recorrido de una definición muestra crear, pausar, reanudar y revisar con su versión'
spec: audit/lifecycle-timeline
related_specs: [commitments/recurrence-engine]
requirement: 'Recorrido de una definición recurrente'
scenario: 'Recorrido del alquiler revisado'
requirement_status: confirmed
fr: ['FR-AUDIT-009', 'FR-COMMITMENTS-009']
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
tags: ['lifecycle', 'recurrence']
error_code: null
preconditions:
  - 'Alquiler creado, pausado el 2026-10-10, reanudado el 2026-10-12 y revisado a 3800.00 BOB desde 2027-01-05'
input: {}
steps:
  - 'GET W/recurring/{id}/lifecycle'
  - 'Reanudar una definición ENDED'
expected_result:
  - 'Transiciones CREATE, PAUSE, RESUME, REVISE en orden con actor e instante; REVISE con versión 2 y fecha efectiva 2027-01-05'
  - 'Reanudar ENDED ⇒ 409 INVALID_STATUS_TRANSITION sin transición registrada'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-041 — El recorrido de una definición muestra crear, pausar, reanudar y revisar con su versión

## Intención

D37: ciclo de vida trazable de la definición.

## Escenario

```gherkin
Dado el "Alquiler" creado, pausado, reanudado y revisado
Cuando el usuario consulta su recorrido
Entonces ve crear, pausar, reanudar y revisar en orden
```

## Notas

- Cubre el scenario "Reanudar una definición terminada".
