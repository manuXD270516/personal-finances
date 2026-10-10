---
id: TC-GOALS-SAVINGS-030
title: "Porcentaje completado y restante con HALF_EVEN al presentar, incluso por encima de 100 %"
spec: goals/savings-goals
related_specs: []
requirement: "Saldo acumulado y porcentaje completado"
scenario: "Un tercio del objetivo"
requirement_status: provisional
fr: ["FR-GOALS-003"]
nfr: ["NFR-DATA-002"]
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "progress", "rounding"]
error_code: null
preconditions:
  - "Meta \"Fondo de emergencia\" (emergency_fund, 15000.00 BOB, inicio 2026-10-01, objetivo 2027-03-31, vinculada a \"Ahorro BOB\", prioridad 1)"
input: {"cases": [{"progress": "5000.00", "percent": "33.33", "remaining": "10000.00"}, {"progress": "16000.00", "percent": "106.67", "remaining": "0.00"}, {"progress": "1000.00", "percent": "6.67"}]}
steps:
  - "GoalProgressCalculator para cada caso"
expected_result:
  - "Los porcentajes y restantes de input, en BOB"
  - "Sin redondeo intermedio (precisión 40)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-030 — Porcentaje completado y restante con HALF_EVEN al presentar, incluso por encima de 100 %

## Intención

Q9 necesita cifras exactas y deterministas.

## Escenario

```gherkin
Dado "Fondo de emergencia" con 5000.00 BOB de 15000.00 BOB
Entonces el porcentaje es 33.33 %
  Y el restante 10000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
