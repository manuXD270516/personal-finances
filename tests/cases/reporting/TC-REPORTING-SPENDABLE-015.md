---
id: TC-REPORTING-SPENDABLE-015
title: "Con Q5 habilitada ninguna pregunta del Home queda no disponible y sin cuentas Q5 indica que no hay datos"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Preguntas del Home sin datos o no disponibles"
scenario: "Workspace sin cuentas"
requirement_status: provisional
fr: ["FR-REPORTING-001"]
nfr: ["NFR-USAB-009"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "home", "empty-state"]
error_code: null
preconditions:
  - "Workspace A con cuentas líquidas; workspace B sin cuentas"
input: {}
steps:
  - "Abrir el Home de A"
  - "Abrir el Home de B"
expected_result:
  - "A: ninguna pregunta con NOT_AVAILABLE_IN_PHASE; Q5 AVAILABLE con monto"
  - "B: Q5 NO_DATA con acción CREATE_ACCOUNT, sin 0.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-015 — Con Q5 habilitada ninguna pregunta del Home queda no disponible y sin cuentas Q5 indica que no hay datos

## Intención

docs/00 §6: nunca un número inventado; Q5 se habilita en Phase 4.

## Escenario

```gherkin
Dado un workspace sin cuentas
Cuando abro el Home
Entonces la pregunta de disponible para gastar indica que no hay datos y ofrece crear una cuenta
  Y no muestra 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- TC-REPORTING-DASHBOARD-005 debe actualizarse: ninguna pregunta queda en questions_not_available.
