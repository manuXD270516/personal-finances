---
id: TC-RULES-ENGINE-034
title: "Una regla con disparador de creación completa la categoría vacía"
spec: rules/rule-engine
related_specs: ["transactions/transaction-recording"]
requirement: "Aplicación al crear una transacción manual"
scenario: "Gasto manual sin categoría"
requirement_status: confirmed
fr: ["FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - packages/contexts/rules/src/domain/rule-evaluator.test.ts
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
  - "Regla \"Telefonía\" v1 (prioridad 100): descripción contiene `tigo` y monto ≤ 150.00 BOB ⇒ categoría Telefonía con disparador MANUAL_CREATE"
input: {"transaction":{"kind":"EXPENSE","description":"Tigo recarga","amount":"100.00","currency":"BOB"}}
steps:
  - "POST W/transactions sin categoría"
expected_result:
  - "Split en Telefonía con categoryOrigin RULE y ruleRefs Telefonía v1"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-034 — Una regla con disparador de creación completa la categoría vacía

## Intención

FR-RULES-009: creación manual opcional por regla.

## Escenario

```gherkin
Dada Telefonía con disparador de creación manual
Cuando registro Tigo recarga de 100.00 BOB sin categoría
Entonces queda en Telefonía por la regla
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
