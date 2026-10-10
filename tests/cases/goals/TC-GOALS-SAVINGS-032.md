---
id: TC-GOALS-SAVINGS-032
title: "Requerido con mes financiero que empieza el 25, con fecha objetivo vencida y sin fecha objetivo"
spec: goals/savings-goals
related_specs: []
requirement: "Aporte mensual requerido"
scenario: "Mes financiero que empieza el día 25"
requirement_status: provisional
fr: ["FR-GOALS-003"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "required", "periods", "timezone"]
error_code: null
preconditions:
  - "Workspace con día de inicio 25 y TZ America/La_Paz"
  - "FixedClock en 2026-10-10 (también 2026-10-24T23:30-04:00 y 2026-10-25T00:05-04:00 con TZ del proceso UTC)"
input: {"cases": [{"startDay": 25, "remaining": "10000.00", "targetDate": "2027-03-31", "expected": "1428.57 (7 periodos)"}, {"startDay": 1, "targetDate": "2026-09-30", "progress": "14000.00", "expected": "1000.00 overdue"}, {"targetDate": null, "expected": "null"}]}
steps:
  - "Calcular el requerido para cada caso"
expected_result:
  - "1428.57 BOB (de \"2026-09\" a \"2027-03\")"
  - "1000.00 BOB con overdue = true"
  - "Sin requerido (null, no 0.00)"
  - "Sin off-by-one en el borde 24/25 de octubre"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-032 — Requerido con mes financiero que empieza el 25, con fecha objetivo vencida y sin fecha objetivo

## Intención

RISK-020: los periodos dependen del día de inicio y de la zona del workspace.

## Escenario

```gherkin
Dado un mes financiero que empieza el día 25 y hoy 2026-10-10
Cuando calculo el requerido de 10000.00 BOB al 2027-03-31
Entonces es 1428.57 BOB en 7 periodos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
