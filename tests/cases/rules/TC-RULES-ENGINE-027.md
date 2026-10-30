---
id: TC-RULES-ENGINE-027
title: "El dry-run en modo completar solo propone campos vacíos y no persiste"
spec: rules/rule-engine
related_specs: []
requirement: "Dry-run sobre transacciones existentes"
scenario: "Completar categorías vacías de septiembre"
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
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
  - "6 gastos con `hipermaxi` en 2026-09: 4 \"sin categoría\" y 2 en Hogar"
input: {"ruleIds":["Supermercado"],"from":"2026-09-01","to":"2026-09-30","mode":"FILL_EMPTY"}
steps:
  - "POST W/rules/dry-run"
expected_result:
  - "changed = 4, todos con category → Supermercado y origen v1"
  - "Los 2 de Hogar sin cambio"
  - "Ninguna transacción modificada; se devuelve token"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-027 — El dry-run en modo completar solo propone campos vacíos y no persiste

## Intención

FR-RULES-008 (Should): diff sin persistir.

## Escenario

```gherkin
Dados 6 gastos de Hipermaxi en septiembre, 4 sin categoría
Cuando ejecuto el dry-run en modo completar
Entonces se proponen 4 cambios
  Y nada cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
