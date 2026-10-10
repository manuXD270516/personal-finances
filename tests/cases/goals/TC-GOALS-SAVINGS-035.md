---
id: TC-GOALS-SAVINGS-035
title: "La simulación devuelve requerido y fecha esperada con otros valores sin persistir nada"
spec: goals/savings-goals
related_specs: []
requirement: "Simulación de escenarios sin persistir"
scenario: "Aportar 2000.00 BOB al mes"
requirement_status: provisional
fr: ["FR-GOALS-006"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "what-if"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 5000.00 BOB, ritmo 1200.00 BOB"
  - "FixedClock en 2026-10-10"
  - "Usuario VIEWER"
input: {"cases": [{"monthlyContribution": "2000.00", "expectedDate": "2027-02-28", "requiredMonthly": "1666.67"}, {"targetDate": "2027-06-30", "requiredMonthly": "1111.11"}, {"targetAmount": "12000.00", "progress": "8000.00", "requiredMonthly": "666.67", "expectedDate": "2027-01-31"}]}
steps:
  - "POST …/simulations con cada caso"
expected_result:
  - "Resultados de input"
  - "La meta conserva versión y datos; sin auditoría de modificación"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-035 — La simulación devuelve requerido y fecha esperada con otros valores sin persistir nada

## Intención

FR-GOALS-006: explorar sin efectos.

## Escenario

```gherkin
Cuando un VIEWER simula aportar 2000.00 BOB por mes
Entonces la fecha esperada simulada es 2027-02-28
  Y la meta no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
