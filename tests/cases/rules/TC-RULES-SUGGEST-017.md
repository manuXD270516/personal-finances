---
id: TC-RULES-SUGGEST-017
title: "Aceptar crea la regla versión 1 sin reclasificar transacciones"
spec: rules/rule-engine
related_specs: []
requirement: "Aceptación explícita de una sugerencia"
scenario: "Aceptar la sugerencia de Tigo"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-001","FR-RULES-008"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/rule-proposals.service.test.ts
  - apps/api/test/api/rule-suggestions.api.test.ts
  - apps/web/src/ui/rules/logic.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
  - "Datos de TC-RULES-SUGGEST-016"
input: {"operacion":"createRule","name":"Recargas Tigo","fromSuggestion":"huella y patrón de Tigo"}
steps:
  - "POST W/rules con la regla propuesta, el nombre \"Recargas Tigo\" y fromSuggestion"
expected_result:
  - "Regla \"Recargas Tigo\" versión 1, disparadores IMPORT y RETROACTIVE, fromSuggestion con la huella"
  - "Decisión ACCEPTED con el ruleId"
  - "Los 3 gastos \"sin categoría\" siguen así"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-017 — Aceptar crea la regla versión 1 sin reclasificar transacciones

## Intención

Aceptación explícita por la vía normal de creación; aplicar a la historia es el dry-run.

## Escenario

```gherkin
Dada la sugerencia de Tigo
Cuando la acepto
Entonces se crea la regla y no cambia ninguna transacción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
