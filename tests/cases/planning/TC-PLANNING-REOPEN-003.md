---
id: TC-PLANNING-REOPEN-003
title: Los periodos se reabren en orden inverso, sin cascada
spec: planning/month-closing
related_specs: []
requirement: Reapertura en orden inverso
scenario: Reabrir octubre con noviembre cerrado
requirement_status: confirmed
fr:
  - FR-PLANNING-006
nfr: []
invariants:
  - INV-015
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - reopen
  - order
error_code: PERIOD_NEXT_CLOSED
preconditions:
  - '"2026-10" y "2026-11" closed'
  - Usuario OWNER
input:
  - reopen: 2026-10
  - reopen: 2026-11
  - reopen: 2026-10
steps:
  - Reabrir "2026-10"
  - Reabrir "2026-11"
  - Reabrir "2026-10"
expected_result:
  - El primer intento se rechaza con PERIOD_NEXT_CLOSED y ambos siguen closed
  - Después se puede reabrir "2026-11" y luego "2026-10"
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-REOPEN-003 — Los periodos se reabren en orden inverso, sin cascada

## Intención

Reabrir un mes con el siguiente cerrado dejaría un snapshot posterior basado en saldos que pueden cambiar.

## Escenario

```gherkin
Dado que "2026-10" y "2026-11" están closed
Cuando el OWNER intenta reabrir "2026-10"
Entonces se rechaza con "PERIOD_NEXT_CLOSED"
```

## Notas

- Sin cascada: pregunta abierta P-A11.
