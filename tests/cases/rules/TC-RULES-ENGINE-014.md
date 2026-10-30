---
id: TC-RULES-ENGINE-014
title: "Marcar para revisión con la regla como motivo"
spec: rules/rule-engine
related_specs: []
requirement: "Acciones de clasificación"
scenario: "Gasto grande marcado para revisión"
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
  - "Regla \"Revisar gastos grandes\" v1: tipo = gasto y monto > 2000.00 BOB ⇒ marcar para revisión"
input: {"subject":{"kind":"EXPENSE","amount":"2450.00","currency":"BOB"}}
steps:
  - "Evaluar la regla"
expected_result:
  - "markForReview = { ruleId: Revisar gastos grandes, ruleVersion: 1 }"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-014 — Marcar para revisión con la regla como motivo

## Intención

Acción "marcar para revisión" pedida por el owner para Phase 6.

## Escenario

```gherkin
Dada la regla de gastos grandes
Cuando evalúo un gasto de 2450.00 BOB
Entonces queda marcado para revisión con esa regla
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
