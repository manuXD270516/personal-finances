---
id: TC-REPORTING-DASHBOARD-005
title: "Las preguntas del Home no habilitadas en Phase 1 se declaran no disponibles sin montos"
spec: reporting/dashboard
related_specs: []
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
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - tests/e2e/specs/dashboard.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["dashboard","home","empty-state"]
error_code: null
preconditions:
  - "Phase 1 desplegada"
  - "Workspace A con cuentas; workspace B sin cuentas"
input: {"questions_not_available":["Q4","Q5","Q8","Q9"]}
steps:
  - "Abrir el Home del workspace A"
  - "Abrir el Home del workspace B"
expected_result:
  - "A: los widgets de Q4, Q5, Q8 y Q9 dicen que aún no están disponibles, sin cifras; la API devuelve status NOT_AVAILABLE_IN_PHASE"
  - "B: \"¿Cuánto dinero tengo?\" indica que no hay cuentas y ofrece crear una; no se muestra 0.00 BOB (status NO_DATA)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-DASHBOARD-005 — Las preguntas del Home no habilitadas en Phase 1 se declaran no disponibles sin montos

## Intención

docs/00 §6: nunca mostrar un número inventado; el widget explica qué falta.

## Escenario

```gherkin
Cuando abro el Home en Phase 1
Entonces los widgets de pagos comprometidos, disponible para gastar, próximos pagos y metas indican que no están disponibles
  Y no muestran montos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
