---
id: TC-GOALS-SAVINGS-033
title: "La fecha esperada sale del ritmo de los últimos 3 periodos terminados, del plan si no hay historia, o no se informa"
spec: goals/savings-goals
related_specs: []
requirement: "Fecha esperada de cumplimiento según el ritmo"
scenario: "Ritmo de 1200.00 BOB al mes"
requirement_status: provisional
fr: ["FR-GOALS-003"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "pace", "expected-date"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-10"
  - "Meta con restante 10000.00 BOB"
input: {"history": {"2026-07": "1200.00", "2026-08": "900.00", "2026-09": "1500.00"}, "plan_case": "2000.00 BOB/mes sin historia", "negative_case": "−200.00 BOB en 3 periodos"}
steps:
  - "ExpectedDateCalculator con la historia"
  - "Con meta creada en \"2026-10\" y plan de 2000.00 BOB"
  - "Sin historia ni plan, y con netos negativos"
expected_result:
  - "pace 1200.00 BOB, expectedDate 2027-06-30"
  - "expectedDate 2027-02-28 con pace.source PLAN"
  - "Sin fecha esperada y \"sin ritmo suficiente\" (NO_PACE)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-033 — La fecha esperada sale del ritmo de los últimos 3 periodos terminados, del plan si no hay historia, o no se informa

## Intención

Q9: cuándo llegaré, explicado con el ritmo real.

## Escenario

```gherkin
Dados movimientos netos de 1200.00, 900.00 y 1500.00 BOB en julio, agosto y septiembre
Cuando calculo la fecha esperada con 10000.00 BOB restantes
Entonces el ritmo es 1200.00 BOB
  Y la fecha esperada es 2027-06-30
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
