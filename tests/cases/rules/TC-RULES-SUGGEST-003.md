---
id: TC-RULES-SUGGEST-003
title: "La evidencia fuera de la ventana de 180 días no cuenta"
spec: rules/rule-engine
related_specs: []
requirement: "Sugerencia de reglas por clasificaciones manuales repetidas"
scenario: "Evidencia fuera de la ventana"
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
  - "3 gastos \"TIGO MONEY RECARGA\" con origen MANUAL en \"Telefonía\" del 2026-04-20, 2026-09-01 y 2026-10-01"
input: {}
steps:
  - "Calcular sugerencias con la ventana por omisión"
expected_result:
  - "Ninguna sugerencia (el del 2026-04-20 queda fuera)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-003 — La evidencia fuera de la ventana de 180 días no cuenta

## Intención

Ventana por fecha de negocio en la zona del workspace.

## Escenario

```gherkin
Dada una repetición antigua
Cuando calculo con 180 días
Entonces no alcanza el apoyo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
