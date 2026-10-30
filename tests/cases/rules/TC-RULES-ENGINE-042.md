---
id: TC-RULES-ENGINE-042
title: "Dos ediciones con la misma versión: la segunda falla"
spec: rules/rule-engine
related_specs: []
requirement: "Versionado de reglas"
scenario: "Edición concurrente"
requirement_status: confirmed
fr: ["FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
  - packages/contexts/rules/src/application/rules.service.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "PRECONDITION_FAILED"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"ifMatch":"misma ETag en dos PUT"}
steps:
  - "Dos PUT W/rules/{id} con la misma ETag"
expected_result:
  - "El primero 200; el segundo 412 PRECONDITION_FAILED"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-042 — Dos ediciones con la misma versión: la segunda falla

## Intención

Control optimista.

## Escenario

```gherkin
Cuando dos EDITOR modifican la regla con la misma versión
Entonces la segunda falla con PRECONDITION_FAILED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
