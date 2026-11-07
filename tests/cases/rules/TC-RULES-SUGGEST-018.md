---
id: TC-RULES-SUGGEST-018
title: "Aceptar dos veces la misma sugerencia se rechaza"
spec: rules/rule-engine
related_specs: []
requirement: "Aceptación explícita de una sugerencia"
scenario: "Aceptar dos veces"
requirement_status: confirmed
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/rule-proposals.service.test.ts
  - apps/api/test/api/rule-suggestions.api.test.ts
  - packages/contexts/rules/test/integration/pg-rules.int.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: RULE_SUGGESTION_DECIDED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
  - "Sugerencia de Tigo ya aceptada"
input: {}
steps:
  - "POST W/rules con el mismo fromSuggestion"
  - "Dos aceptaciones concurrentes de otra sugerencia"
expected_result:
  - "409 RULE_SUGGESTION_DECIDED y ninguna regla nueva"
  - "En la concurrencia, una 201 y la otra 409"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-018 — Aceptar dos veces la misma sugerencia se rechaza

## Intención

Clave única por huella en la misma unidad de trabajo.

## Escenario

```gherkin
Dada una sugerencia aceptada
Cuando la acepto de nuevo
Entonces se rechaza
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
