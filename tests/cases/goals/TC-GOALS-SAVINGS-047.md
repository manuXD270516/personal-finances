---
id: TC-GOALS-SAVINGS-047
title: "Con metas habilitadas solo Q5 sigue no disponible y un workspace sin metas ofrece crear una sin mostrar 0 %"
spec: reporting/dashboard
related_specs: ["goals/savings-goals"]
requirement: "Preguntas del Home sin datos o no disponibles"
scenario: "Workspace sin metas"
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
tags: ["goals", "home", "empty-state"]
error_code: null
preconditions:
  - "Workspace A con cuentas y sin metas; workspace B con una meta activa"
input: {}
steps:
  - "Abrir el Home de A"
  - "Abrir el Home de B"
expected_result:
  - "A: Q9 NO_DATA con acción CREATE_GOAL, sin 0 %; Q5 NOT_AVAILABLE_IN_PHASE"
  - "B: Q9 AVAILABLE; Q5 sigue NOT_AVAILABLE_IN_PHASE hasta add-spendable-amount"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-047 — Con metas habilitadas solo Q5 sigue no disponible y un workspace sin metas ofrece crear una sin mostrar 0 %

## Intención

Nunca un número inventado (docs/00 §6); Q9 se habilita en Phase 4.

## Escenario

```gherkin
Dado un workspace con cuentas y sin metas
Cuando abro el Home
Entonces la pregunta de metas indica que no hay metas y ofrece crear una
  Y no muestra 0 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- TC-REPORTING-DASHBOARD-005 debe actualizarse: Q9 deja de estar en questions_not_available.
