---
id: TC-RULES-SUGGEST-010
title: "Confianza de cuatro de cinco alcanza el mínimo con nivel media"
spec: rules/rule-engine
related_specs: []
requirement: "Confianza de la sugerencia"
scenario: "Cuatro de cinco"
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
  - "5 gastos \"PEDIDOSYA\" con origen MANUAL: 4 en \"Restaurantes\" y 1 en \"Supermercado\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Sugerencia hacia \"Restaurantes\" con confianza 0.8000"
  - "Nivel MEDIUM"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-010 — Confianza de cuatro de cinco alcanza el mínimo con nivel media

## Intención

Umbral 0.8000 inclusivo.

## Escenario

```gherkin
Dados 4 de 5 en Restaurantes
Cuando calculo sugerencias
Entonces la confianza es 0.8000
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
