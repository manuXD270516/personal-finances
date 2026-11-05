---
id: TC-RULES-SUGGEST-015
title: "La sugerencia muestra evidencia y contraejemplos"
spec: rules/rule-engine
related_specs: []
requirement: "Explicación de la sugerencia"
scenario: "Evidencia y contraejemplo de PedidosYa"
requirement_status: confirmed
fr: ["FR-RULES-011"]
nfr: ["NFR-USAB-104"]
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/rule-proposals.service.test.ts
  - apps/api/test/api/rule-suggestions.api.test.ts
  - apps/web/src/ui/rules/rules.test.tsx
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
  - "Datos de TC-RULES-SUGGEST-010"
input: {}
steps:
  - "GET W/rules/suggestions"
expected_result:
  - "evidence con las 4 transacciones (fecha, descripción, monto, cuenta)"
  - "counterExamples con la transacción en \"Supermercado\""
  - "support 4, total 5, confidence \"0.8000\""
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-015 — La sugerencia muestra evidencia y contraejemplos

## Intención

Sugerencia explicable; la UI arma los textos.

## Escenario

```gherkin
Dada la sugerencia de PedidosYa
Cuando la consulto
Entonces veo evidencia y contraejemplo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
