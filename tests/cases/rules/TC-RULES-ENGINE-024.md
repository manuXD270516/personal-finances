---
id: TC-RULES-ENGINE-024
title: "Una acción omitida por tipo de categoría deja fijar el campo a la siguiente regla"
spec: rules/rule-engine
related_specs: []
requirement: "Referencias y acciones no aplicables"
scenario: "Categoría de gasto sobre un ingreso"
requirement_status: confirmed
fr: ["FR-RULES-005", "FR-RULES-006"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/rule-evaluator.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"rules":"A (10): categoría de gasto Supermercado; B (20): categoría de ingreso Reembolsos varios","subject":"ingreso 40.00 BOB"}
steps:
  - "Evaluar"
expected_result:
  - "A omitida con CATEGORY_KIND_MISMATCH"
  - "category = Reembolsos varios (origen B)"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-024 — Una acción omitida por tipo de categoría deja fijar el campo a la siguiente regla

## Intención

Una acción omitida no escribe el campo (design decisión 2).

## Escenario

```gherkin
Dadas A con categoría de gasto y B con categoría de ingreso
Cuando evalúo un ingreso de 40.00 BOB
Entonces la categoría es Reembolsos varios por B
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
