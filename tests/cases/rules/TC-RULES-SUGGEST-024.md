---
id: TC-RULES-SUGGEST-024
title: "Cálculo con 5 000 transacciones y 200 reglas en 3 segundos"
spec: rules/rule-engine
related_specs: []
requirement: "Límites y rendimiento de las sugerencias"
scenario: "Cálculo con 200 reglas"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-006"]
nfr: []
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/rules.perf.ts
status: automated
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
  - "5 000 transacciones de evidencia sintéticas"
  - "200 reglas activas de 5 condiciones (una con matches_regex)"
input: {}
steps:
  - "Benchmark nightly de listRuleSuggestions"
expected_result:
  - "Tiempo del servidor ≤ 3 s"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-024 — Cálculo con 5 000 transacciones y 200 reglas en 3 segundos

## Intención

Mismo presupuesto que la evaluación del import.

## Escenario

```gherkin
Dadas 5 000 transacciones y 200 reglas
Cuando calculo sugerencias
Entonces tarda 3 s o menos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
