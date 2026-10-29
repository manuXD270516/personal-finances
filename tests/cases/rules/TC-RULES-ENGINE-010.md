---
id: TC-RULES-ENGINE-010
title: "Regex con referencia hacia atrás, lookaround o demasiado larga se rechaza"
spec: rules/rule-engine
related_specs: []
requirement: "Expresiones regulares acotadas"
scenario: "Patrón con referencia hacia atrás"
requirement_status: provisional
fr: ["FR-RULES-003"]
nfr: ["NFR-SEC-009"]
invariants: []
priority: high
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "RULE_INVALID_REGEX"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"patterns":["(a+)\\1","(?=a)a","a{201 caracteres}","([a-z"]}
steps:
  - "POST W/rules con cada patrón"
expected_result:
  - "422 RULE_INVALID_REGEX en los cuatro casos"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-010 — Regex con referencia hacia atrás, lookaround o demasiado larga se rechaza

## Intención

Solo construcciones de tiempo lineal (RE2).

## Escenario

```gherkin
Cuando guardo una regla con el patrón (a+)\1
Entonces se rechaza con RULE_INVALID_REGEX
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
