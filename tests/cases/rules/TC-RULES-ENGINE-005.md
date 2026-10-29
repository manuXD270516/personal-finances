---
id: TC-RULES-ENGINE-005
title: "Día del mes y tipo se evalúan sobre la fecha de negocio"
spec: rules/rule-engine
related_specs: []
requirement: "Campos de condición"
scenario: "Día del mes y tipo de transacción"
requirement_status: provisional
fr: ["FR-RULES-002"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"conditions":["KIND = INCOME","DAY_OF_MONTH in 1..5"],"subjects":["ingreso 2026-09-03","ingreso 2026-09-15"]}
steps:
  - "Evaluar la regla sobre ambos ingresos"
expected_result:
  - "Solo el ingreso del 2026-09-03 cumple"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-005 — Día del mes y tipo se evalúan sobre la fecha de negocio

## Intención

Campos de fecha derivados de la fecha de negocio, sin conversión de zona.

## Escenario

```gherkin
Dada la regla "tipo = ingreso" y "día del mes en 1..5"
Cuando evalúo ingresos del 3 y del 15 de septiembre de 2026
Entonces solo cumple el del 3
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
