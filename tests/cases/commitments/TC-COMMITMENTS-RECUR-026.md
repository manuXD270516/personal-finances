---
id: TC-COMMITMENTS-RECUR-026
title: 'Aprobar una ocurrencia en un periodo cerrado se rechaza y se puede aprobar tras mover su fecha'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Ocurrencias en periodos cerrados'
scenario: 'Aprobar en septiembre cerrado'
requirement_status: provisional
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-015']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'closed-period']
error_code: PERIOD_CLOSED
preconditions:
  - 'Periodo 2026-09 cerrado'
  - 'Ocurrencia OVERDUE del Internet con vencimiento 2026-09-20'
  - 'Hoy 2026-10-02'
input: {}
steps:
  - 'Aprobar sin fecha'
  - 'Editar la fecha a 2026-10-02 y aprobar'
expected_result:
  - 'Primera: PERIOD_CLOSED, ocurrencia sigue OVERDUE, sin transacción'
  - 'Segunda: gasto con fecha 2026-10-02 y ocurrencia MATERIALIZED'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-026 — Aprobar una ocurrencia en un periodo cerrado se rechaza y se puede aprobar tras mover su fecha

## Intención

INV-015 y D69: no se crean transacciones (ni pending) en periodos cerrados.

## Escenario

```gherkin
Dado el periodo "2026-09" cerrado
Cuando el EDITOR aprueba la ocurrencia del "Internet" del 2026-09-20
Entonces se rechaza con PERIOD_CLOSED
  Y al editar su fecha a 2026-10-02 y aprobarla se crea el gasto
```

## Notas

- En AUTO_CREATE la ocurrencia queda OVERDUE con lastAutoCreateError = PERIOD_CLOSED (design decisión 9).
