---
id: TC-PLANNING-RECLOSE-002
title: La comparación entre versiones muestra las diferencias exactas
spec: planning/month-closing
related_specs: []
requirement: Comparación entre versiones del snapshot
scenario: Diferencias entre el snapshot 1 y el 2 de octubre
requirement_status: confirmed
fr:
  - FR-PLANNING-006
  - FR-PLANNING-004
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - snapshot
error_code: null
preconditions:
  - Snapshots 1 y 2 de "2026-10" como en TC-PLANNING-RECLOSE-001
input:
  from: 1
  to: 2
steps:
  - Comparar los snapshots 1 y 2
expected_result:
  - Bank A -15.00 BOB; gastos consolidados +15.00 BOB; ahorro -15.00 BOB; patrimonio neto -15.00 BOB
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-RECLOSE-002 — La comparación entre versiones muestra las diferencias exactas

## Intención

Hace visible qué cambió entre cierres de un mismo mes (docs/09 §10: detectar diferencias tras reaperturas).

## Escenario

```gherkin
Dado los snapshots 1 y 2 de "2026-10"
Cuando se comparan
Entonces la diferencia en "Bank A" es -15.00 BOB y en gastos consolidados +15.00 BOB
```

## Notas

- Requirement Should.
