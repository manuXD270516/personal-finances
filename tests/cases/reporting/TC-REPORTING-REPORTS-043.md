---
id: TC-REPORTING-REPORTS-043
title: "El reporte de metas informa el acumulado mensual sin contar reasignaciones como aportes"
spec: reporting/financial-reports
related_specs: ["goals/savings-goals"]
requirement: "Reporte de metas de ahorro"
scenario: "Meta de viaje"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-GOALS-003"]
nfr: []
invariants: ["INV-018"]
priority: medium
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - packages/contexts/goals/src/application/goals.queries.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["goals"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Meta \"Viaje\": objetivo 5000.00 BOB, inicio 2026-07-01, fecha objetivo 2027-06-30"
  - "Aportes 500.00 (jul), 500.00 (ago), 1000.00 (oct); retiro 200.00 (oct)"
input: {}
steps:
  - "Calcular el reporte de metas de 2026-07 a 2026-10"
expected_result:
  - "Acumulados 500.00, 1000.00, 1000.00 y 1800.00 BOB"
  - "Esperado y estado iguales a los del seguimiento de GOALS a cada cierre"
  - "Una reasignación entre metas no suma aportes"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-043 — El reporte de metas informa el acumulado mensual sin contar reasignaciones como aportes

## Intención

Reporte 9 con la misma regla de seguimiento que la meta.

## Escenario

```gherkin
Dado la meta "Viaje" con sus movimientos
Cuando se pide el reporte de metas
Entonces los acumulados son 500.00, 1000.00, 1000.00 y 1800.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
