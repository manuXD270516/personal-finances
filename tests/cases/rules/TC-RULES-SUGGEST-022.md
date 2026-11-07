---
id: TC-RULES-SUGGEST-022
title: "La evidencia de otro workspace nunca genera sugerencias"
spec: rules/rule-engine
related_specs: ["security/access-control"]
requirement: "Permisos, auditoría y aislamiento de las sugerencias"
scenario: "Evidencia de otro workspace"
requirement_status: confirmed
fr: ["FR-RULES-011"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: high
type: security
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/rule-suggestions.api.test.ts
  - packages/contexts/rules/test/integration/pg-rules.int.test.ts
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
  - "\"W2\" con 5 gastos \"TIGO MONEY RECARGA\" MANUAL en \"Telefonía\"; \"W1\" sin ninguno"
input: {}
steps:
  - "Calcular sugerencias en \"W1\""
  - "Leer rules.rule_suggestion_decision sin contexto de workspace"
expected_result:
  - "\"W1\" sin sugerencia para el patrón"
  - "La lectura sin contexto falla con PF002 (fail-closed)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-022 — La evidencia de otro workspace nunca genera sugerencias

## Intención

RLS forzada y fail-closed en la tabla nueva.

## Escenario

```gherkin
Dada evidencia solo en W2
Cuando W1 calcula sugerencias
Entonces no recibe ninguna
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
