---
id: TC-RULES-SUGGEST-019
title: "Una sugerencia descartada no reaparece aunque crezca su evidencia"
spec: rules/rule-engine
related_specs: []
requirement: "Descartar una sugerencia"
scenario: "Descartar PedidosYa"
requirement_status: provisional
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
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
  - "Datos de TC-RULES-SUGGEST-010"
input: {}
steps:
  - "POST W/rules/suggestions/{id}/dismiss"
  - "Clasificar a mano 3 gastos \"PEDIDOSYA\" más en \"Restaurantes\""
  - "GET W/rules/suggestions y GET W/rules/suggestions?includeDismissed=true"
expected_result:
  - "No aparece en el listado normal"
  - "Aparece como DISMISSED con apoyo 7"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-019 — Una sugerencia descartada no reaparece aunque crezca su evidencia

## Intención

La huella no incluye el apoyo.

## Escenario

```gherkin
Dada una sugerencia descartada
Cuando crece su evidencia
Entonces sigue descartada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
