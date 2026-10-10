---
id: TC-GOALS-SAVINGS-004
title: "Cambiar el objetivo reevalúa el estado: alcanzada al bajarlo y reabierta al subirlo"
spec: goals/savings-goals
related_specs: []
requirement: "Edición de una meta"
scenario: "Bajar el objetivo por debajo de lo ahorrado"
requirement_status: provisional
fr: ["FR-GOALS-001", "FR-GOALS-008"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "state"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1) con 12500.00 BOB acumulados"
  - "Meta \"Laptop\" ACHIEVED con 9000.00 de 9000.00 BOB"
input: {"emergencia_target": "12000.00 BOB", "laptop_target": "10000.00 BOB"}
steps:
  - "PATCH \"Fondo de emergencia\" con objetivo 12000.00 BOB e If-Match"
  - "PATCH \"Laptop\" con objetivo 10000.00 BOB"
expected_result:
  - "\"Fondo de emergencia\" pasa a ACHIEVED con percent \"104.17\" y se publica goals.GoalReached.v1 con trigger TARGET_CHANGE"
  - "\"Laptop\" vuelve a ACTIVE con percent \"90.00\""
  - "Cada transición queda auditada"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-004 — Cambiar el objetivo reevalúa el estado: alcanzada al bajarlo y reabierta al subirlo

## Intención

El estado depende del objetivo vigente; un cambio de objetivo no puede dejar una meta alcanzada por debajo del objetivo ni ignorar que ya se superó.

## Escenario

```gherkin
Dado "Fondo de emergencia" con 12500.00 BOB de 15000.00 BOB
Cuando el EDITOR cambia el objetivo a 12000.00 BOB
Entonces la meta pasa a ACHIEVED con 104.17 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
