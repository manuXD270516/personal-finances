---
id: TC-RULES-SUGGEST-004
title: "Categorías fijadas por reglas no son evidencia"
spec: rules/rule-engine
related_specs: ["transactions/transaction-recording"]
requirement: "Evidencia de clasificación manual"
scenario: "Clasificaciones hechas por una regla no son evidencia"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-010"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/rule-proposals.service.test.ts
  - apps/api/test/api/rule-suggestions.api.test.ts
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
  - "5 gastos \"HIPERMAXI SUC 12\" con categoría \"Supermercado\" y origen RULE (regla \"Supermercado\")"
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "listEvidence no devuelve esos gastos"
  - "Ninguna sugerencia para el patrón"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-004 — Categorías fijadas por reglas no son evidencia

## Intención

Solo lo decidido por el usuario es evidencia.

## Escenario

```gherkin
Dados gastos clasificados por una regla
Cuando calculo sugerencias
Entonces no cuentan
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
