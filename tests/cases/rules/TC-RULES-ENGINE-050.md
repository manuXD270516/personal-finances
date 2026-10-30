---
id: TC-RULES-ENGINE-050
title: "Evaluar 5 000 filas contra 200 reglas tarda 3 s o menos"
spec: rules/rule-engine
related_specs: []
requirement: "Límites y rendimiento de la evaluación"
scenario: "Evaluación de un import grande"
requirement_status: confirmed
fr: ["FR-RULES-006"]
nfr: ["NFR-PERF-007"]
invariants: []
priority: high
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/rules.perf.ts
  - packages/contexts/rules/src/application/performance.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "perf"]
error_code: null
preconditions:
  - "Generador sintético: 5 000 filas y 200 reglas activas de 5 condiciones, una con matches_regex"
input: {"rows":5000,"rules":200}
steps:
  - "Medir RuleEvaluationQuery.evaluate en el benchmark nightly (pnpm perf:bench)"
  - "Medir e informar el peor caso 500 × 20 sin umbral"
expected_result:
  - "Duración ≤ 3 s"
  - "Peor caso publicado en perf-summary.md"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-050 — Evaluar 5 000 filas contra 200 reglas tarda 3 s o menos

## Intención

Dentro del presupuesto de 30 s de NFR-PERF-007 para la vista previa.

## Escenario

```gherkin
Dadas 5 000 filas y 200 reglas activas
Cuando las evalúo
Entonces la evaluación termina en 3 s o menos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
