---
id: TC-IDENTITY-DEMO-026
title: "La demo carga READY con anclas cuyo día de plan de metas es 29 a 31 y los aportes siguen la regla de la meta"
spec: identity/demo-data
related_specs: ["goals/plans"]
requirement: "Contenido demo ficticio, realista y determinista"
scenario: "Ancla con el día del plan de metas en 29 a 31"
requirement_status: confirmed
fr: ["FR-IDENTITY-014"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/src/demo/dataset/plan-modules/goals.test.ts","apps/api/test/demo/demo-v2.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "determinism", "month-end", "goals"]
error_code: DEMO_LOAD_FAILED
preconditions:
  - "Dataset Demo v2 y workspace demo con la ancla 2026-11-25 (America/La_Paz)"
input: {"anchor":"2026-11-25"}
steps:
  - "Barrer las anclas de 2025 a 2027 y comparar los aportes del Fondo de emergencia del plan con las ocurrencias de la regla mensual del dominio"
  - "Cargar la demo con la ancla 2026-11-25 y esperar READY"
expected_result:
  - "Para toda ancla: las fechas de los aportes y de las ocurrencias del plan son exactamente las de la regla del dominio (día del plan con tope al último día del mes)"
  - "Con la ancla 2026-11-25 los aportes incluyen 2025-12-31 y no 2025-12-30"
  - "La carga con la ancla 2026-11-25 termina READY, sin DEMO_LOAD_FAILED"
created: 2026-11-25
updated: 2026-11-25
---

# TC-IDENTITY-DEMO-026 — Anclas con día de plan de metas 29 a 31

## Intención

El plan del Fondo de emergencia corre el día de `A − 25`. Con día 31 el dataset encadenaba los aportes desde una primera fecha ya recortada (`2025-11-30`, luego `2025-12-30`) y la regla de la meta resuelve cada mes desde el día del plan (`2025-12-31`): la carga terminaba `FAILED` con `occurrence {"type":"goalPlan","key":"emergency"} of 2025-12-30 not found` (desde 2026-11-25; rompió la integración y el e2e de todos los PR).

## Escenario

```gherkin
Dado la demo v2
Cuando la cargo con la ancla 2026-11-25
Entonces termina READY
  Y los aportes del Fondo de emergencia caen el último día de cada mes corto
```

## Notas

- Anclas afectadas antes de la corrección (2025-2027): 23-25 de febrero, 25 de abril, 25 de junio, 25 de septiembre y 25 de noviembre.
- El test unitario compara con `ruleFromCadence`/`expandRecurrence` de `@pf/shared-kernel` (la regla que usa COMMITMENTS para la definición administrada); la carga completa lo contrasta con el motor real.
- Change: `fix-demo-goal-plan-anchor`.
