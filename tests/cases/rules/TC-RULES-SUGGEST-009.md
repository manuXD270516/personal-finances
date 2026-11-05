---
id: TC-RULES-SUGGEST-009
title: "La contraparte gana sobre una descripción contenida en su evidencia"
spec: rules/rule-engine
related_specs: []
requirement: "Patrones por descripción normalizada y por contraparte"
scenario: "Contraparte con glosas distintas"
requirement_status: provisional
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
  - "4 gastos con contraparte \"Farmacorp\" y descripciones \"FARMACORP SUC 3\", \"FARMACORP SUC 9\", \"FARMACORP SUC 12\" y \"QR FARMACORP\", origen MANUAL en \"Farmacia\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Sugerencia COUNTERPARTY = Farmacorp y KIND = EXPENSE ⇒ Farmacia con apoyo 4"
  - "Sin sugerencia por `farmacorp suc` (evidencia de 3 contenida en la de la contraparte)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-009 — La contraparte gana sobre una descripción contenida en su evidencia

## Intención

Deduplicación determinista.

## Escenario

```gherkin
Dada una contraparte con glosas distintas
Cuando calculo sugerencias
Entonces se sugiere solo la regla por contraparte
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
