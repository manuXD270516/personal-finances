---
id: TC-RULES-SUGGEST-002
title: "Dos repeticiones no alcanzan el apoyo mínimo"
spec: rules/rule-engine
related_specs: []
requirement: "Sugerencia de reglas por clasificaciones manuales repetidas"
scenario: "Dos repeticiones no alcanzan"
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
  - "2 gastos \"TIGO MONEY RECARGA\" con origen MANUAL en \"Telefonía\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Ninguna sugerencia para el patrón"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-002 — Dos repeticiones no alcanzan el apoyo mínimo

## Intención

Apoyo mínimo 3.

## Escenario

```gherkin
Dadas 2 repeticiones
Cuando calculo sugerencias
Entonces no hay sugerencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
