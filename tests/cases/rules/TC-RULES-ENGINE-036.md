---
id: TC-RULES-ENGINE-036
title: "applyRules false evita aplicar reglas"
spec: rules/rule-engine
related_specs: ["transactions/transaction-recording"]
requirement: "Aplicación al crear una transacción manual"
scenario: "Creación sin reglas"
requirement_status: confirmed
fr: ["FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/rule-classification.test.ts
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
input: {"applyRules":false}
steps:
  - "POST W/transactions sin categoría con applyRules = false"
expected_result:
  - "Split sin categoría con categoryOrigin SYSTEM_DEFAULT y sin ruleRefs"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-036 — applyRules false evita aplicar reglas

## Intención

El usuario puede pedir no aplicar reglas.

## Escenario

```gherkin
Cuando registro el gasto sin categoría pidiendo no aplicar reglas
Entonces queda sin categoría y sin regla
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
