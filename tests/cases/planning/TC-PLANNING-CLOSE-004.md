---
id: TC-PLANNING-CLOSE-004
title: Los periodos se cierran en orden cronológico
spec: planning/month-closing
related_specs: []
requirement: Cierre en orden cronológico
scenario: Cerrar noviembre con octubre abierto
requirement_status: provisional
fr:
  - FR-PLANNING-001
  - FR-PLANNING-004
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
  - order
error_code: PERIOD_PREVIOUS_NOT_CLOSED
preconditions:
  - '"2026-10" active pendiente de cierre'
  - '"2026-11" terminado sin observaciones'
  - '"2026-07" es el primer periodo de otro workspace, terminado'
input:
  - close: 2026-11
  - close: 2026-07 (primer periodo)
steps:
  - Cerrar "2026-11"
  - Cerrar el primer periodo "2026-07"
expected_result:
  - '"2026-11" se rechaza con PERIOD_PREVIOUS_NOT_CLOSED y sigue active'
  - '"2026-07" se cierra sin periodo anterior'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-CLOSE-004 — Los periodos se cierran en orden cronológico

## Intención

El saldo de apertura de cada snapshot depende de que el anterior esté congelado.

## Escenario

```gherkin
Dado que "2026-10" está active
Cuando el EDITOR intenta cerrar "2026-11"
Entonces se rechaza con "PERIOD_PREVIOUS_NOT_CLOSED"
```

## Notas

- Cubre "Primer periodo del workspace".
