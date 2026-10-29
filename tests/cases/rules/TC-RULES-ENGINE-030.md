---
id: TC-RULES-ENGINE-030
title: "Un cambio posterior al dry-run rechaza toda la aplicación"
spec: rules/rule-engine
related_specs: []
requirement: "Aplicación del dry-run como edición masiva auditada"
scenario: "Una transacción cambió después del dry-run"
requirement_status: provisional
fr: ["FR-RULES-008"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "RULE_DRY_RUN_STALE"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"edit":"uno de los 4 gastos entre el dry-run y la aplicación"}
steps:
  - "Editar un gasto"
  - "POST W/rules/dry-run/apply"
expected_result:
  - "409 RULE_DRY_RUN_STALE"
  - "Ninguno de los 4 cambia"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-030 — Un cambio posterior al dry-run rechaza toda la aplicación

## Intención

Todo o nada con versión por ítem.

## Escenario

```gherkin
Dado un gasto editado después del dry-run
Cuando aplico
Entonces se rechaza con RULE_DRY_RUN_STALE y nada cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
