---
id: TC-RULES-ENGINE-026
title: "La vista previa muestra la condición que no se cumple"
spec: rules/rule-engine
related_specs: []
requirement: "Vista previa de una regla"
scenario: "Condición que falla"
requirement_status: confirmed
fr: ["FR-RULES-007"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - apps/web/src/ui/rules/rules.test.tsx
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
input: {"sample":{"description":"TIGO MONEY RECARGA","amount":"180.00","currency":"BOB"}}
steps:
  - "POST W/rules/preview"
expected_result:
  - "matched = false; condición de monto met = false con actual 180.00 BOB"
  - "actions = []"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-026 — La vista previa muestra la condición que no se cumple

## Intención

Explicabilidad de la vista previa.

## Escenario

```gherkin
Cuando pruebo con 180.00 BOB
Entonces la condición de monto aparece no cumplida
  Y no hay acciones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
