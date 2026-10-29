---
id: TC-RULES-ENGINE-006
title: "Una condición sobre un campo personalizado usa el valor del split"
spec: rules/rule-engine
related_specs: []
requirement: "Campos de condición"
scenario: "Campo personalizado de la transacción"
requirement_status: provisional
fr: ["FR-RULES-002", "FR-CLASSIFICATION-009"]
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
  - "Campo personalizado SELECT `proyecto` (TRANSACTION) con opción `casa`"
input: {"condition":"CUSTOM_FIELD proyecto equals casa"}
steps:
  - "Evaluar sobre un gasto con proyecto = casa y otro sin valor"
expected_result:
  - "Solo el gasto con proyecto = casa cumple"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-006 — Una condición sobre un campo personalizado usa el valor del split

## Intención

FR-RULES-002 incluye custom fields de transacciones.

## Escenario

```gherkin
Dada la condición "proyecto = casa"
Cuando evalúo un gasto con ese valor y otro sin valor
Entonces solo cumple el primero
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
