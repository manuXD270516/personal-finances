---
id: TC-COMMITMENTS-RECUR-028
title: 'Una ocurrencia omitida no crea transacción, no cuenta como comprometida y no se regenera'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Omitir una ocurrencia'
scenario: 'Gimnasio omitido en vacaciones'
requirement_status: provisional
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-013']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'skip']
error_code: null
preconditions:
  - 'Gimnasio MIN_MAX con ocurrencia 2026-12-28 SCHEDULED'
input:
  reason: 'vacaciones'
steps:
  - 'Omitir la ocurrencia'
  - 'Calcular el comprometido de 2026-12'
  - 'Re-ejecutar la generación'
expected_result:
  - 'Ocurrencia SKIPPED con motivo'
  - 'No suma al comprometido'
  - 'Sigue existiendo una sola fila SKIPPED para 2026-12-28'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-028 — Una ocurrencia omitida no crea transacción, no cuenta como comprometida y no se regenera

## Intención

FR-COMMITMENTS-008: skip definitivo.

## Escenario

```gherkin
Dado la ocurrencia del 2026-12-28 del "Gimnasio"
Cuando el EDITOR la omite con el motivo "vacaciones"
Entonces queda omitida y no cuenta en el comprometido de diciembre
```

## Notas

