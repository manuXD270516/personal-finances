---
id: TC-RULES-SUGGEST-012
title: "Confianza redondeada a cuatro decimales HALF_EVEN"
spec: rules/rule-engine
related_specs: []
requirement: "Confianza de la sugerencia"
scenario: "Redondeo de la confianza"
requirement_status: provisional
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: property
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
  - "6 gastos \"UBER TRIP\" con origen MANUAL: 5 en \"Taxi\" y 1 en \"Viajes\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Confianza 0.8333 (5 ÷ 6 = 0.83333…)"
  - "Nivel MEDIUM"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-012 — Confianza redondeada a cuatro decimales HALF_EVEN

## Intención

Decimal exacto, sin punto flotante.

## Escenario

```gherkin
Dados 5 de 6
Cuando calculo la confianza
Entonces es 0.8333
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
