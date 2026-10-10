---
id: TC-COMMITMENTS-RECUR-007
title: 'La RRULE del último viernes de cada mes se expande en la zona del workspace'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cadencia RRULE personalizada'
scenario: 'Último viernes de cada mes'
requirement_status: provisional
fr: ['FR-COMMITMENTS-003']
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'rrule']
error_code: null
preconditions:
  - 'RRULE FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1, dtstart 2026-10-01'
input:
  window: '2026-10-01..2026-12-31'
steps:
  - 'Parsear y expandir la RRULE'
expected_result:
  - '[2026-10-30, 2026-11-27, 2026-12-25]'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-007 — La RRULE del último viernes de cada mes se expande en la zona del workspace

## Intención

FR-COMMITMENTS-003 (Should): subconjunto de RFC 5545 para cadencias no predefinidas.

## Escenario

```gherkin
Dado la regla FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1 desde 2026-10-01
Cuando se expande hasta 2026-12-31
Entonces las fechas son 2026-10-30, 2026-11-27 y 2026-12-25
```

## Notas

- Ejecutar con TZ del proceso forzada a UTC y America/La_Paz: el resultado no cambia.
