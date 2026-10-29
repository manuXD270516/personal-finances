---
id: TC-RULES-ENGINE-046
title: "La cobertura por import usa solo sus transacciones"
spec: rules/rule-engine
related_specs: []
requirement: "Cobertura de clasificación por reglas"
scenario: "Cobertura de un import"
requirement_status: provisional
fr: ["FR-RULES-010", "FR-IMPORTS-008"]
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
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"importJobId":"import de octubre: 57 creadas, 41 por reglas"}
steps:
  - "GET W/rules/coverage?importJobId=…"
expected_result:
  - "total 57; RULE 41; ruleCoverage \"0.7193\""
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-046 — La cobertura por import usa solo sus transacciones

## Intención

Cobertura de cada import.

## Escenario

```gherkin
Dado el import de octubre con 57 transacciones, 41 por reglas
Cuando consulto su cobertura
Entonces el cociente es 0.7193
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
