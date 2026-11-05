---
id: TC-RULES-SUGGEST-028
title: "Restaurar una sugerencia descartada la vuelve a mostrar"
spec: rules/rule-engine
related_specs: []
requirement: "Descartar una sugerencia"
scenario: null
requirement_status: provisional
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: low
type: api
level: api
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
  - "Sugerencia de PEDIDOSYA descartada"
  - "Sugerencia de Tigo aceptada"
input: {}
steps:
  - "POST W/rules/suggestions/{PEDIDOSYA}/restore"
  - "POST W/rules/suggestions/{Tigo}/restore"
expected_result:
  - "PEDIDOSYA vuelve al listado normal; restauración auditada"
  - "Tigo: 409 RULE_SUGGESTION_DECIDED"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-028 — Restaurar una sugerencia descartada la vuelve a mostrar

## Intención

Restaurar es Could y solo aplica a descartadas.

## Escenario

```gherkin
Dada una sugerencia descartada
Cuando la restauro
Entonces vuelve a aparecer
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
