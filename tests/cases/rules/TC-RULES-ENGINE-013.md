---
id: TC-RULES-ENGINE-013
title: "Una regla propone categoría, etiqueta y contraparte sin tocar el monto"
spec: rules/rule-engine
related_specs: []
requirement: "Acciones de clasificación"
scenario: "Fila importada del supermercado"
requirement_status: confirmed
fr: ["FR-RULES-005"]
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
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
input: {"row":{"description":"HIPERMAXI SUC 12","amount":"185.40","currency":"BOB","kind":"EXPENSE"}}
steps:
  - "RuleEvaluationQuery.evaluate con trigger IMPORT"
expected_result:
  - "category = Supermercado, addTags = [hogar], counterparty = Hipermaxi, cada uno con origen Supermercado v1"
  - "El sujeto conserva 185.40 BOB"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-013 — Una regla propone categoría, etiqueta y contraparte sin tocar el monto

## Intención

FR-RULES-005: acciones de clasificación con origen por campo.

## Escenario

```gherkin
Dada la regla Supermercado
Cuando evalúo HIPERMAXI SUC 12 de 185.40 BOB
Entonces propone Supermercado, hogar e Hipermaxi
  Y el monto sigue en 185.40 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
