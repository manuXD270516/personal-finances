---
id: TC-RULES-ENGINE-025
title: "La vista previa de una definición no guarda ni audita"
spec: rules/rule-engine
related_specs: []
requirement: "Vista previa de una regla"
scenario: "Probar una definición sin guardar"
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
  - tests/e2e/specs/rules.spec.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario VIEWER autenticado"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"definition":"contiene tigo y monto ≤ 150.00 BOB ⇒ Telefonía","sample":{"description":"TIGO MONEY RECARGA","amount":"100.00","currency":"BOB","kind":"EXPENSE"}}
steps:
  - "POST W/rules/preview con la definición y el ejemplo"
expected_result:
  - "matched = true; ambas condiciones met = true; actions = [SET_CATEGORY Telefonía]"
  - "Sin reglas nuevas ni auditoría"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-025 — La vista previa de una definición no guarda ni audita

## Intención

FR-RULES-007; VIEWER puede probar.

## Escenario

```gherkin
Dada una definición sin guardar
Cuando la pruebo con TIGO MONEY RECARGA de 100.00 BOB
Entonces veo ambas condiciones cumplidas y la acción
  Y no se guarda nada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
