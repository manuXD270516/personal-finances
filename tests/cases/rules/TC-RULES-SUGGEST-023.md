---
id: TC-RULES-SUGGEST-023
title: "Evidencia de más de 5 000 transacciones queda truncada a las más recientes"
spec: rules/rule-engine
related_specs: []
requirement: "Límites y rendimiento de las sugerencias"
scenario: "Ventana con más de 5 000 transacciones"
requirement_status: confirmed
fr: ["FR-RULES-011","FR-RULES-006"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/rule-proposals.service.test.ts
  - apps/api/test/api/rule-suggestions.api.test.ts
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
  - "6 200 transacciones de evidencia sintéticas en la ventana"
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "scanned 5000 y truncated true"
  - "Se usan las 5 000 de fecha más reciente"
  - "Como máximo 50 sugerencias, ordenadas por apoyo, confianza y patrón"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-023 — Evidencia de más de 5 000 transacciones queda truncada a las más recientes

## Intención

Costo acotado.

## Escenario

```gherkin
Dadas 6 200 transacciones de evidencia
Cuando calculo sugerencias
Entonces se usan las 5 000 más recientes
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
