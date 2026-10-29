---
id: TC-RULES-ENGINE-012
title: "Un grupo ANY de un nivel dentro de una regla ALL"
spec: rules/rule-engine
related_specs: []
requirement: "Combinación de condiciones con ALL y ANY"
scenario: "Grupo ANY dentro de una regla ALL"
requirement_status: provisional
fr: ["FR-RULES-004"]
nfr: []
invariants: []
priority: medium
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
input: {"match":"ALL","items":["KIND = EXPENSE",{"match":"ANY","items":["contains uber","contains yango"]}]}
steps:
  - "Evaluar sobre gasto \"YANGO VIAJE\" 18.50 BOB e ingreso \"UBER REEMBOLSO\" 18.50 BOB"
  - "Intentar guardar un segundo nivel de anidamiento"
expected_result:
  - "Solo el gasto cumple"
  - "El segundo nivel se rechaza con VALIDATION_FAILED"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-012 — Un grupo ANY de un nivel dentro de una regla ALL

## Intención

FR-RULES-004 (Should): un nivel de grupos.

## Escenario

```gherkin
Dada la regla ALL con tipo gasto y un grupo ANY uber/yango
Cuando evalúo YANGO VIAJE (gasto) y UBER REEMBOLSO (ingreso)
Entonces solo cumple el gasto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
