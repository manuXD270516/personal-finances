---
id: TC-RULES-ENGINE-028
title: "El modo de reemplazo propone también los campos ya clasificados"
spec: rules/rule-engine
related_specs: []
requirement: "Dry-run sobre transacciones existentes"
scenario: "Modo de reemplazo"
requirement_status: confirmed
fr: ["FR-RULES-008"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - packages/contexts/rules/src/application/evaluation.test.ts
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
input: {"mode":"OVERWRITE"}
steps:
  - "POST W/rules/dry-run con mode OVERWRITE"
  - "Repetir con un rango de 6 000 transacciones"
expected_result:
  - "changed = 6"
  - "Con 6 000 transacciones: truncated = true y scanned = 5000"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-028 — El modo de reemplazo propone también los campos ya clasificados

## Intención

Modo explícito y tope de 5 000.

## Escenario

```gherkin
Cuando repito el dry-run en modo de reemplazo
Entonces se proponen los 6 gastos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
