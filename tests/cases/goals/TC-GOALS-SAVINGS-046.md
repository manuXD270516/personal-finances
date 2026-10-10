---
id: TC-GOALS-SAVINGS-046
title: "La tarjeta Q9 del Home muestra hasta 3 metas por prioridad y fecha objetivo con sus cálculos y la cantidad restante"
spec: reporting/dashboard
related_specs: ["goals/savings-goals"]
requirement: "Metas en curso en el Home"
scenario: "Cuatro metas activas"
requirement_status: provisional
fr: ["FR-REPORTING-001", "FR-REPORTING-002", "FR-GOALS-003"]
nfr: ["NFR-PERF-004"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "home", "q9"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Metas \"Fondo de emergencia\" (p1, 33.33 %, behind), \"Viaje a Cusco\" (p2, objetivo 2027-06-30, 45.00 %), \"Laptop\" (p2, sin fecha, 22.22 %, sobre-asignada) y \"Auto\" (p3)"
input: {}
steps:
  - "GET W/reports/summary"
  - "Abrir el Home"
expected_result:
  - "goals.items = Fondo de emergencia, Viaje a Cusco, Laptop; moreCount = 1"
  - "Fondo de emergencia con percent 33.33, tracking BEHIND, requiredMonthly y expectedDate"
  - "Laptop con overAllocated = true"
  - "p95 del resumen ≤ 300 ms"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-046 — La tarjeta Q9 del Home muestra hasta 3 metas por prioridad y fecha objetivo con sus cálculos y la cantidad restante

## Intención

Q9 respondida en el Home con los mismos cálculos de goals/savings-goals.

## Escenario

```gherkin
Dadas cuatro metas activas
Cuando abro el Home
Entonces la tarjeta de Q9 muestra tres metas por prioridad
  Y indica 1 meta más
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
