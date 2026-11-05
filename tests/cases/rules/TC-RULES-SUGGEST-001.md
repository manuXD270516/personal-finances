---
id: TC-RULES-SUGGEST-001
title: "Cuatro recargas de Tigo clasificadas a mano generan una sugerencia"
spec: rules/rule-engine
related_specs: []
requirement: "Sugerencia de reglas por clasificaciones manuales repetidas"
scenario: "Recargas de Tigo clasificadas a mano"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-001"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/rule-proposal.test.ts
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
  - "4 gastos \"TIGO MONEY RECARGA <número>\" de 20.00 a 50.00 BOB entre 2026-07-02 y 2026-10-28, origen MANUAL, categoría \"Telefonía\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Sugerencia: DESCRIPTION contains `tigo money recarga` y KIND = EXPENSE ⇒ SET_CATEGORY Telefonía"
  - "Apoyo 4, total 4, confianza 1.0000"
  - "Disparadores IMPORT y RETROACTIVE"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-001 — Cuatro recargas de Tigo clasificadas a mano generan una sugerencia

## Intención

FR-RULES-011: ≥ 3 repeticiones del mismo patrón.

## Escenario

```gherkin
Dadas 4 recargas de Tigo clasificadas a mano
Cuando calculo sugerencias
Entonces se sugiere la regla hacia Telefonía
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
