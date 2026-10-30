---
id: TC-RULES-ENGINE-038
title: "Una corrección manual cambia el origen del campo sin borrar la historia"
spec: rules/rule-engine
related_specs: ["transactions/transaction-recording"]
requirement: "Trazabilidad de la regla aplicada"
scenario: "Corrección manual posterior"
requirement_status: confirmed
fr: ["FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/web/src/ui/rules/rules.test.tsx
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
input: {"patch":"categoría ⇒ Hogar"}
steps:
  - "PATCH W/transactions/{id} con la categoría Hogar"
expected_result:
  - "category Hogar con origen MANUAL; etiqueta hogar conserva origen Supermercado v1"
  - "La auditoría conserva el valor anterior con su regla"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-038 — Una corrección manual cambia el origen del campo sin borrar la historia

## Intención

Origen por campo, historia en la auditoría.

## Escenario

```gherkin
Dado el gasto clasificado por la regla
Cuando cambio la categoría a Hogar
Entonces la categoría queda con origen manual
  Y la etiqueta conserva su regla
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
