---
id: TC-COMMITMENTS-RECUR-008
title: 'Una RRULE con partes fuera del subconjunto o con COUNT y UNTIL juntos se rechaza'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cadencia RRULE personalizada'
scenario: 'Parte no soportada'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-003']
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/shared-kernel/src/recurrence/recurrence.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'rrule']
error_code: INVALID_RRULE
preconditions:
  - 'Ninguna'
input:
  a: 'FREQ=HOURLY;INTERVAL=2'
  b: 'FREQ=MONTHLY;COUNT=12;UNTIL=20271231'
  c: 'FREQ=MONTHLY;BYMONTH=2'
steps:
  - 'Parsear cada regla'
expected_result:
  - 'Las tres se rechazan con INVALID_RRULE'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-008 — Una RRULE con partes fuera del subconjunto o con COUNT y UNTIL juntos se rechaza

## Intención

Acotar la RRULE evita sobre-ingeniería (RISK-005) y comportamientos no probados.

## Escenario

```gherkin
Cuando se crea una definición con FREQ=HOURLY;INTERVAL=2
Entonces se rechaza con INVALID_RRULE
```

## Notas

- Cubre el scenario "COUNT y UNTIL juntos".
