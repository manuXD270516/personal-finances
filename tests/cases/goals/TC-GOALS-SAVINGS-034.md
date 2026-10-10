---
id: TC-GOALS-SAVINGS-034
title: "El estado behind, on-track o ahead compara con el esperado lineal y la tolerancia es inclusiva"
spec: goals/savings-goals
related_specs: []
requirement: "Estado de avance respecto del plan lineal"
scenario: "Tres estados a mitad de camino"
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
tags: ["goals", "tracking"]
error_code: null
preconditions:
  - "Meta \"Auto\" de 10000.00 BOB del 2026-01-01 al 2026-04-11 (100 días), tolerancia 5.00 %"
  - "FixedClock en 2026-02-20 (50 días, esperado 5000.00 BOB)"
input: {"cases": [{"progress": "4800.00", "status": "ON_TRACK", "deviation": "-4.00"}, {"progress": "4700.00", "status": "BEHIND", "deviation": "-6.00"}, {"progress": "5300.00", "status": "AHEAD", "deviation": "6.00"}, {"progress": "4750.00", "status": "ON_TRACK", "deviation": "-5.00"}]}
steps:
  - "GoalTrackingEvaluator para cada caso"
  - "Pausar la meta y consultar"
expected_result:
  - "Estados y desvíos de input"
  - "Pausada: sin estado de avance, se informa \"pausada\""
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-034 — El estado behind, on-track o ahead compara con el esperado lineal y la tolerancia es inclusiva

## Intención

Q9 "¿voy a cumplir?" con un criterio explicable (pregunta 7).

## Escenario

```gherkin
Dada "Auto" de 10000.00 BOB con 50 de 100 días transcurridos
Cuando tiene 4800.00 BOB
Entonces el estado es on-track (−4.00 %)
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
