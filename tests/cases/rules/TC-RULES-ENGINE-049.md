---
id: TC-RULES-ENGINE-049
title: "No se admiten más de 500 reglas no archivadas"
spec: rules/rule-engine
related_specs: []
requirement: "Límites y rendimiento de la evaluación"
scenario: "Regla número 501"
requirement_status: confirmed
fr: ["FR-RULES-006"]
nfr: ["NFR-PERF-007"]
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - packages/contexts/rules/src/application/rules.service.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "RULE_LIMIT_EXCEEDED"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
  - "500 reglas no archivadas"
input: {}
steps:
  - "POST W/rules"
expected_result:
  - "422 RULE_LIMIT_EXCEEDED"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-049 — No se admiten más de 500 reglas no archivadas

## Intención

Límite configurable RULES_MAX_PER_WORKSPACE.

## Escenario

```gherkin
Dadas 500 reglas no archivadas
Cuando creo otra
Entonces se rechaza con RULE_LIMIT_EXCEEDED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
