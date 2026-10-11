---
id: TC-REPORTING-DASHBOARD-005
title: "Solo Q5 se declara no disponible sin montos; Q4 y Q8 las responde el calendario de flujo y Q9 las metas de ahorro"
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
  - apps/web/src/ui/upcoming/upcoming.test.tsx
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
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
  - "Workspace A con cuentas; workspace B sin cuentas"
input: {"questions_not_available":["Q5"],"questions_answered_by_cash_flow_calendar":["Q4","Q8"],"questions_answered_by_goals":["Q9"]}
steps:
  - "Abrir el Home del workspace A"
  - "Abrir el Home del workspace B"
expected_result:
  - "A: solo el widget de Q5 dice que aún no está disponible, sin cifras; la API devuelve status NOT_AVAILABLE_IN_PHASE solo para Q5; Q4 y Q8 no se declaran no disponibles (con una definición activa o una pendiente de egreso son AVAILABLE; sin ellas, NO_DATA con CREATE_COMMITMENT, TC-REPORTING-UPCOMING-018); Q9 tampoco: sin metas es NO_DATA con CREATE_GOAL y sin 0 % (TC-GOALS-SAVINGS-047)"
  - "B: \"¿Cuánto dinero tengo?\" indica que no hay cuentas y ofrece crear una; no se muestra 0.00 BOB (status NO_DATA); Q4 y Q8 también NO_DATA con la acción de crear la primera cuenta, sin montos; Q9 NO_DATA con CREATE_GOAL"
created: 2026-10-02
updated: 2026-10-11
---

# TC-REPORTING-DASHBOARD-005 — Las preguntas del Home no habilitadas se declaran no disponibles sin montos; Q4 y Q8 las responde reporting/cash-flow-calendar y Q9 las metas

## Intención

docs/00 §6: nunca mostrar un número inventado; el widget explica qué falta. Con `add-upcoming-payments` (Phase 3) Q4 y Q8 dejan de declararse no disponibles y con `add-savings-goals` (Phase 4) también Q9; la pregunta que sigue sin habilitarse (Q5) conserva el comportamiento de Phase 1.

## Escenario

```gherkin
Cuando abro el Home con cuentas
Entonces el widget de disponible para gastar indica que no está disponible
  Y no muestra montos
  Y comprometido y próximos pagos los responde reporting/cash-flow-calendar
  Y la pregunta de metas no se declara no disponible
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- Cambio de Phase 3: el scenario "Pagos próximos aún no disponibles" (nombre conservado: un MODIFIED no puede renombrar scenarios) pasa a cubrir solo las preguntas aún no habilitadas (Q5 y Q9); delta MODIFIED en `openspec/changes/add-upcoming-payments/specs/reporting/dashboard/spec.md`.
