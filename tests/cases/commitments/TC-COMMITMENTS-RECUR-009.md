---
id: TC-COMMITMENTS-RECUR-009
title: 'Una ocurrencia pasa a atrasada al cambiar el día en America/La_Paz aunque el proceso corra en UTC'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Fechas locales en la zona horaria del workspace'
scenario: 'Atraso a medianoche de La Paz'
requirement_status: provisional
fr: ['FR-COMMITMENTS-003', 'FR-COMMITMENTS-005']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'timezone']
error_code: null
preconditions:
  - 'Workspace America/La_Paz; proceso con TZ=UTC'
  - 'Ocurrencia DUE del "Internet" con vencimiento 2026-10-20'
input:
  t1: '2026-10-21T03:30:00Z'
  t2: '2026-10-21T04:05:00Z'
steps:
  - 'Evaluar OccurrenceClock en t1'
  - 'Evaluar OccurrenceClock en t2'
expected_result:
  - 'En t1 la ocurrencia sigue DUE'
  - 'En t2 pasa a OVERDUE'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-009 — Una ocurrencia pasa a atrasada al cambiar el día en America/La_Paz aunque el proceso corra en UTC

## Intención

RISK-020: hoy se calcula en la zona del workspace, nunca en la del proceso.

## Escenario

```gherkin
Dado el workspace en America/La_Paz y el proceso en UTC
Cuando son las 2026-10-21T03:30Z
Entonces la ocurrencia del 2026-10-20 no está atrasada
  Y a las 2026-10-21T04:05Z sí lo está
```

## Notas

- Repetir con TZ=America/La_Paz en el proceso.
