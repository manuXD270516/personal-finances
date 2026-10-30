---
id: TC-RULES-ENGINE-056
title: "La edición masiva deja el origen manual"
spec: transactions/transaction-recording
related_specs: ["rules/rule-engine", "transactions/bulk-edit"]
requirement: "Origen de la clasificación de cada split"
scenario: "Edición masiva de la categoría"
requirement_status: confirmed
fr: ["FR-RULES-010", "FR-TRANSACTIONS-033"]
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
input: {"bulkEdit":"categoría ⇒ Hogar sobre el gasto de 185.40 BOB"}
steps:
  - "POST W/transactions/bulk-edit"
expected_result:
  - "categoryOrigin MANUAL y sin ruleRefs de categoría"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-056 — La edición masiva deja el origen manual

## Intención

Todo cambio del usuario es manual.

## Escenario

```gherkin
Dado el gasto clasificado por regla
Cuando cambio su categoría por edición masiva
Entonces su origen es manual
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
