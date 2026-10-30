---
id: TC-RULES-ENGINE-041
title: "Editar la definición crea una versión nueva e inmutable"
spec: rules/rule-engine
related_specs: []
requirement: "Versionado de reglas"
scenario: "Edición de las acciones"
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
  - packages/contexts/rules/src/domain/rule.test.ts
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
  - "Regla \"Supermercado\" v1 sin etiqueta"
input: {"addAction":"ADD_TAG hogar"}
steps:
  - "PUT W/rules/{id} con If-Match"
  - "GET W/rules/{id}/versions"
expected_result:
  - "version = 2"
  - "La versión 1 conserva sus acciones originales"
  - "Transacciones previas siguen con origen v1"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-041 — Editar la definición crea una versión nueva e inmutable

## Intención

FR-RULES-010: versión aplicada trazable.

## Escenario

```gherkin
Dada la regla en la versión 1
Cuando agrego la acción etiqueta hogar
Entonces pasa a la versión 2
  Y la versión 1 sigue consultable
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
