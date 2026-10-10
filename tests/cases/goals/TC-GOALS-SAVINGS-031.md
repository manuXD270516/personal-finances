---
id: TC-GOALS-SAVINGS-031
title: "El aporte mensual requerido divide el restante por los periodos financieros hasta la fecha objetivo, ambos incluidos"
spec: goals/savings-goals
related_specs: []
requirement: "Aporte mensual requerido"
scenario: "Seis periodos hasta marzo"
requirement_status: provisional
fr: ["FR-GOALS-003"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "required", "periods"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 5000.00 BOB"
  - "FixedClock en 2026-10-10T12:00:00-04:00"
input: {"remaining": "10000.00 BOB", "periods": 6}
steps:
  - "RequiredContributionCalculator con hoy 2026-10-10 y fecha objetivo 2027-03-31"
expected_result:
  - "requiredMonthly = 1666.67 BOB"
  - "periods = 6 (\"2026-10\" a \"2027-03\")"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-031 — El aporte mensual requerido divide el restante por los periodos financieros hasta la fecha objetivo, ambos incluidos

## Intención

FR-GOALS-003: requerido por periodos del workspace, no por meses calendario.

## Escenario

```gherkin
Dado hoy 2026-10-10 y "Fondo de emergencia" con 10000.00 BOB restantes al 2027-03-31
Entonces el aporte mensual requerido es 1666.67 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
