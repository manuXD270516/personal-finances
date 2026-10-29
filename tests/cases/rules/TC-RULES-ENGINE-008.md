---
id: TC-RULES-ENGINE-008
title: "is_empty sobre contraparte distingue gastos sin contraparte"
spec: rules/rule-engine
related_specs: []
requirement: "Operadores y comparación de texto"
scenario: "Contraparte vacía"
requirement_status: provisional
fr: ["FR-RULES-003"]
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
input: {"condition":"COUNTERPARTY is_empty"}
steps:
  - "Evaluar sobre un gasto sin contraparte y otro con \"Hipermaxi\""
expected_result:
  - "Solo el gasto sin contraparte cumple"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-008 — is_empty sobre contraparte distingue gastos sin contraparte

## Intención

Operadores is_empty / is_not_empty.

## Escenario

```gherkin
Dada la condición "contraparte vacía"
Cuando evalúo un gasto sin contraparte y otro con Hipermaxi
Entonces solo cumple el primero
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
