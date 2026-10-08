---
id: TC-PLANNING-ISOLATION-001
title: Los periodos están aislados por workspace y la consulta sin contexto falla
spec: planning/financial-periods
related_specs: []
requirement: Aislamiento de workspace en los periodos
scenario: Calendarios independientes
requirement_status: confirmed
fr:
  - FR-PLANNING-001
nfr:
  - NFR-SEC-003
  - NFR-SEC-004
invariants: []
priority: critical
type: security
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/planning/test/integration/pg-planning.int.test.ts
status: automated
regression_suite: true
phase: 2
tags:
  - financial-periods
  - rls
error_code: null
preconditions:
  - W1 con día de inicio 1 y W2 con día de inicio 25, ambos con "2026-10"
  - Rol pf_app con RLS
input:
  workspaces:
    - W1
    - W2
steps:
  - Con contexto W1, listar periodos
  - Sin establecer app.workspace_id, consultar los periodos
expected_result:
  - W1 ve solo su "2026-10" (2026-10-01..2026-10-31); W2 tiene "2026-10" (2026-10-25..2026-11-24)
  - La consulta sin contexto falla con PF002 en lugar de devolver 0 filas
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ISOLATION-001 — Los periodos están aislados por workspace y la consulta sin contexto falla

## Intención

RISK-021: tabla nueva con workspace_id debe tener RLS fail-closed.

## Escenario

```gherkin
Dado W1 con día de inicio 1 y W2 con día de inicio 25
Cuando W1 lista sus periodos
Entonces nunca observa los periodos de W2
```

## Notas

- Cubre "Consulta sin contexto de workspace".
