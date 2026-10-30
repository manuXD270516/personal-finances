---
id: TC-RULES-ENGINE-017
title: "Una acción sobre monto, moneda, cuenta, fecha, tipo o estado se rechaza"
spec: rules/rule-engine
related_specs: []
requirement: "Las reglas no cambian datos financieros"
scenario: "Acción sobre el monto"
requirement_status: confirmed
fr: ["FR-RULES-005"]
nfr: []
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/condition.test.ts
  - packages/contexts/rules/src/infrastructure/dsl-schema.test.ts
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
input: {"actions":["amount = 100.00 BOB","currency","accountId","date","kind","status"]}
steps:
  - "POST W/rules con cada acción prohibida"
expected_result:
  - "422 VALIDATION_FAILED en los seis casos"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-017 — Una acción sobre monto, moneda, cuenta, fecha, tipo o estado se rechaza

## Intención

El JSON Schema de acciones no tiene esas propiedades (additionalProperties: false).

## Escenario

```gherkin
Cuando guardo una regla con la acción "monto = 100.00 BOB"
Entonces se rechaza con VALIDATION_FAILED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
