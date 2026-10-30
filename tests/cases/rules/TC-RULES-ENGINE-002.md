---
id: TC-RULES-ENGINE-002
title: "Una regla sin acciones o fuera de los límites se rechaza"
spec: rules/rule-engine
related_specs: []
requirement: "Definición de reglas WHEN/THEN"
scenario: "Regla sin acciones"
requirement_status: confirmed
fr: ["FR-RULES-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - apps/web/src/ui/rules/logic.test.ts
  - packages/contexts/rules/src/application/rules.service.test.ts
  - packages/contexts/rules/src/domain/condition.test.ts
  - packages/contexts/rules/src/domain/rule.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"cases":["0 acciones","21 condiciones","11 acciones"]}
steps:
  - "POST W/rules con una condición y 0 acciones"
  - "POST W/rules con 21 condiciones"
  - "POST W/rules con 11 acciones"
expected_result:
  - "422 VALIDATION_FAILED con puntero en cada caso"
  - "Ninguna regla creada"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-002 — Una regla sin acciones o fuera de los límites se rechaza

## Intención

Límites estructurales de docs/08 §5.13 (1–20 condiciones, 1–10 acciones).

## Escenario

```gherkin
Cuando creo una regla con una condición y ninguna acción
Entonces se rechaza con VALIDATION_FAILED
  Y no existe ninguna regla nueva
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
