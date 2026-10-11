---
id: TC-GOALS-SAVINGS-038
title: "El pendiente planificado del periodo es el planificado menos lo aportado, nunca negativo"
spec: goals/savings-goals
related_specs: []
requirement: "Aporte mensual planificado"
scenario: "Pendiente del periodo"
requirement_status: confirmed
fr: ["FR-GOALS-009"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/goals.api.test.ts
  - apps/web/src/ui/goals/goals.test.tsx
  - apps/web/src/ui/goals/logic.test.ts
  - packages/contexts/commitments/src/application/goal-managed.service.test.ts
  - packages/contexts/goals/src/application/goals.queries.test.ts
  - packages/contexts/goals/src/application/plan.service.test.ts
status: automated
regression_suite: false
phase: 4
tags: ["goals", "plan"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con plan de 1500.00 BOB por mes"
  - "Periodo \"2026-10\""
input: {"cases": [{"contributed": "1000.00", "pending": "500.00"}, {"contributed": "1800.00", "pending": "0.00", "exceededBy": "300.00"}], "usd_plan_for_viaje": "1000.00 BOB"}
steps:
  - "GoalPlansQuery.getForPeriod para cada caso"
  - "PUT …/plan de \"Viaje a Cusco\" (USD) con 1000.00 BOB"
expected_result:
  - "Pendientes de input"
  - "El plan en otra moneda se rechaza con CURRENCY_MISMATCH"
created: 2026-10-10
updated: 2026-10-11
---

# TC-GOALS-SAVINGS-038 — El pendiente planificado del periodo es el planificado menos lo aportado, nunca negativo

## Intención

Insumo de la sección de Planning y de Q5 (add-spendable-amount).

## Escenario

```gherkin
Dado un plan de 1500.00 BOB y 1000.00 BOB aportados en el periodo
Entonces el pendiente planificado es 500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
