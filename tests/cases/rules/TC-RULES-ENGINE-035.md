---
id: TC-RULES-ENGINE-035
title: "Las reglas no reemplazan la categoría elegida por el usuario"
spec: rules/rule-engine
related_specs: ["transactions/transaction-recording"]
requirement: "Aplicación al crear una transacción manual"
scenario: "El usuario ya eligió categoría"
requirement_status: provisional
fr: ["FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"categoryId":"Regalos"}
steps:
  - "POST W/transactions con categoría Regalos"
expected_result:
  - "Split en Regalos con categoryOrigin MANUAL"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-035 — Las reglas no reemplazan la categoría elegida por el usuario

## Intención

Modo completar vacíos en la creación manual.

## Escenario

```gherkin
Cuando registro el gasto con la categoría Regalos
Entonces queda en Regalos con origen manual
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
