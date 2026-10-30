---
id: TC-RULES-ENGINE-057
title: "Filtrar y quitar la marca de revisión sin tocar el ledger"
spec: transactions/transaction-recording
related_specs: ["rules/rule-engine"]
requirement: "Marca de revisión pendiente"
scenario: "Filtrar y resolver las pendientes de revisión"
requirement_status: confirmed
fr: ["FR-RULES-005", "FR-TRANSACTIONS-033"]
nfr: []
invariants: ["INV-029"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - apps/web/src/ui/rules/rules.test.tsx
  - packages/contexts/transactions/src/application/rule-classification.test.ts
  - tests/e2e/specs/rules.spec.ts
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
  - "3 gastos importados marcados por \"Revisar gastos grandes\" v1, uno de 2450.00 BOB"
input: {"filter":"needsReview=true"}
steps:
  - "GET W/transactions?needsReview=true"
  - "PATCH del gasto de 2450.00 BOB con needsReview false e If-Match"
expected_result:
  - "Exactamente 3 resultados con review.reason RULE y la regla"
  - "Saldo sin cambio y auditoría de la resolución"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-057 — Filtrar y quitar la marca de revisión sin tocar el ledger

## Intención

Marca de revisión de Transactions.

## Escenario

```gherkin
Dados 3 gastos marcados para revisión
Cuando filtro y quito la marca de uno
Entonces veo los 3
  Y el saldo no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
