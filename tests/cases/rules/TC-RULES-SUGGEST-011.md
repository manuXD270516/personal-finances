---
id: TC-RULES-SUGGEST-011
title: "Confianza de tres de cuatro queda debajo del mínimo"
spec: rules/rule-engine
related_specs: []
requirement: "Confianza de la sugerencia"
scenario: "Tres de cuatro no alcanza"
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
  - "4 gastos \"PEDIDOSYA\" con origen MANUAL: 3 en \"Restaurantes\" y 1 en \"Supermercado\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Ninguna sugerencia (0.7500 < 0.8000)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-011 — Confianza de tres de cuatro queda debajo del mínimo

## Intención

Patrones ambiguos no se sugieren.

## Escenario

```gherkin
Dados 3 de 4
Cuando calculo sugerencias
Entonces no hay sugerencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
