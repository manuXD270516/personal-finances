---
id: TC-RULES-ENGINE-009
title: "Un operador incompatible con el campo se rechaza al guardar"
spec: rules/rule-engine
related_specs: []
requirement: "Operadores y comparación de texto"
scenario: "Operador incompatible"
requirement_status: provisional
fr: ["FR-RULES-003"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"condition":{"field":"AMOUNT","operator":"starts_with","value":"100","currency":"BOB"}}
steps:
  - "POST W/rules con la condición"
expected_result:
  - "422 VALIDATION_FAILED con puntero /conditions/items/0/operator"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-009 — Un operador incompatible con el campo se rechaza al guardar

## Intención

Matriz operador × tipo de campo (design decisión 8).

## Escenario

```gherkin
Cuando guardo "monto starts_with 100"
Entonces se rechaza con VALIDATION_FAILED señalando la condición
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
