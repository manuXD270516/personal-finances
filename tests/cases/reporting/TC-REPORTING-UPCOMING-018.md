---
id: TC-REPORTING-UPCOMING-018
title: "Sin compromisos ni pendientes Q4 y Q8 indican que no hay datos sin mostrar 0.00 BOB"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Preguntas Q4 y Q8 habilitadas en el Home"
scenario: "Sin compromisos ni pendientes"
requirement_status: confirmed
fr: ["FR-REPORTING-016","FR-REPORTING-001"]
nfr: ["NFR-USAB-009"]
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/upcoming-payments.api.test.ts
  - apps/web/src/ui/upcoming/upcoming.test.tsx
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/home-questions.test.ts
  - tests/e2e/specs/upcoming-payments.spec.ts
status: automated
regression_suite: false
phase: 3
tags: ["home","q4","q8","empty-state"]
error_code: null
preconditions:
  - "Workspace con cuentas, sin definiciones recurrentes activas y sin transacciones pendientes"
input: {}
steps:
  - "Consultar getReportSummary y getUpcomingPayments?days=7"
  - "Abrir el Home"
expected_result:
  - "homeQuestions Q4 y Q8: status NO_DATA, actionHint CREATE_COMMITMENT"
  - "Las tarjetas ofrecen crear un compromiso y no muestran 0.00 BOB"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-018 — Sin compromisos ni pendientes Q4 y Q8 indican que no hay datos sin mostrar 0.00 BOB

## Intención

FR-REPORTING-001: una pregunta sin datos lo dice con la acción que la habilita; un cero sustituto engañaría.

## Escenario

```gherkin
Dado un workspace sin compromisos ni pendientes
Cuando abro el Home
Entonces Q4 y Q8 dicen que no hay datos y ofrecen crear un compromiso
  Y no muestran 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
