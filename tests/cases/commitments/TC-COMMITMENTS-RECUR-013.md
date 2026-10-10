---
id: TC-COMMITMENTS-RECUR-013
title: 'El ajuste de fin de semana mueve solo el vencimiento y conserva la fecha nominal'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Ajuste de fin de semana'
scenario: 'Sábado al viernes anterior'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-005']
nfr: []
invariants: ['INV-013']
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/domain/generation.test.ts
  - packages/shared-kernel/src/recurrence/recurrence.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'weekend']
error_code: null
preconditions:
  - '2026-10-10 es sábado; 2026-10-25 es domingo'
input:
  internet: 'MONTHLY día 10, PREVIOUS'
  sueldo: 'MONTHLY día 25, NEXT'
steps:
  - 'Generar la ocurrencia de octubre de cada definición'
expected_result:
  - 'Internet: nominal 2026-10-10, vencimiento 2026-10-09'
  - 'Sueldo: nominal 2026-10-25, vencimiento 2026-10-26'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-013 — El ajuste de fin de semana mueve solo el vencimiento y conserva la fecha nominal

## Intención

La clave nominal estable es lo que hace idempotente la generación (INV-013).

## Escenario

```gherkin
Dado el "Internet" del día 10 con ajuste PREVIOUS
Cuando se genera octubre de 2026
Entonces la fecha nominal es 2026-10-10 y el vencimiento 2026-10-09
```

## Notas

- Cubre el scenario "Domingo al lunes siguiente".
