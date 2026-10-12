---
id: TC-REPORTING-DASHBOARD-005
title: "Con Q5 habilitada ninguna pregunta del Home queda no disponible por fase y sin cuentas se declara sin datos, sin montos"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Preguntas del Home sin datos o no disponibles"
scenario: "Pagos próximos aún no disponibles"
requirement_status: confirmed
fr: ["FR-REPORTING-001"]
nfr: ["NFR-USAB-009"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
  - apps/web/src/ui/dashboard/DashboardView.test.tsx
  - apps/web/src/ui/spendable/spendable.test.tsx
  - apps/web/src/ui/upcoming/upcoming.test.tsx
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/application/spendable.queries.test.ts
  - packages/contexts/reporting/src/domain/home-questions.test.ts
  - tests/e2e/specs/dashboard.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["dashboard","home","empty-state"]
error_code: null
preconditions:
  - "Phase 3 desplegada (add-upcoming-payments): Q4 y Q8 las responde reporting/cash-flow-calendar"
  - "Phase 4 desplegada (add-savings-goals): Q9 la responde goals/savings-goals; el workspace A no tiene metas activas, pausadas ni alcanzadas"
  - "Phase 4 desplegada (add-spendable-amount): Q5 la responde reporting/dashboard con el disponible para gastar"
  - "Workspace A con cuentas; workspace B sin cuentas"
input: {"questions_not_available":[],"questions_answered_by_cash_flow_calendar":["Q4","Q8"],"questions_answered_by_goals":["Q9"],"questions_answered_by_spendable_amount":["Q5"]}
steps:
  - "Abrir el Home del workspace A"
  - "Abrir el Home del workspace B"
expected_result:
  - "A: ninguna pregunta se declara no disponible por fase (la API no devuelve NOT_AVAILABLE_IN_PHASE y el Home ya no muestra la sección \"Próximamente\"); Q5 muestra el disponible para gastar con su desglose (TC-REPORTING-SPENDABLE-001); Q4 y Q8 no se declaran no disponibles (con una definición activa o una pendiente de egreso son AVAILABLE; sin ellas, NO_DATA con CREATE_COMMITMENT, TC-REPORTING-UPCOMING-018); Q9 tampoco: sin metas es NO_DATA con CREATE_GOAL y sin 0 % (TC-GOALS-SAVINGS-047)"
  - "B: \"¿Cuánto dinero tengo?\" indica que no hay cuentas y ofrece crear una; no se muestra 0.00 BOB (status NO_DATA); Q4, Q5 y Q8 también NO_DATA con la acción de crear la primera cuenta, sin montos (TC-REPORTING-SPENDABLE-015); Q9 NO_DATA con CREATE_GOAL"
created: 2026-10-02
updated: 2026-10-12
---

# TC-REPORTING-DASHBOARD-005 — Ninguna pregunta del Home queda no disponible por fase: Q4 y Q8 las responde reporting/cash-flow-calendar, Q9 las metas y Q5 el disponible para gastar

## Intención

docs/00 §6: nunca mostrar un número inventado; el widget explica qué falta. Con `add-upcoming-payments` (Phase 3) Q4 y Q8 dejan de declararse no disponibles, con `add-savings-goals` (Phase 4) también Q9 y con `add-spendable-amount` (Phase 4, último change de la fase) Q5: el estado `NOT_AVAILABLE_IN_PHASE` queda sin uso en el Home y solo se conserva `NO_DATA` con la acción que habilita cada pregunta.

## Escenario

```gherkin
Cuando abro el Home con cuentas
Entonces ninguna pregunta se declara no disponible
  Y el disponible para gastar muestra un monto
  Y comprometido y próximos pagos los responde reporting/cash-flow-calendar
  Y la pregunta de metas no se declara no disponible
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- Cambio de Phase 4 (`add-spendable-amount`): el scenario "Pagos próximos aún no disponibles" (nombre conservado: un MODIFIED no puede renombrar scenarios) pasa a cubrir que ninguna pregunta queda no disponible por fase; delta MODIFIED en `openspec/changes/add-spendable-amount/specs/reporting/dashboard/spec.md`.
