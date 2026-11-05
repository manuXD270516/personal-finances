---
id: TC-RULES-SUGGEST-006
title: "Clasificaciones anteriores al motor de reglas cuentan como evidencia"
spec: rules/rule-engine
related_specs: []
requirement: "Evidencia de clasificación manual"
scenario: "Historia anterior al motor de reglas"
requirement_status: confirmed
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
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
  - "3 gastos \"GIMNASIO BODYTECH\" con source MANUAL de junio de 2026, categoría \"Gimnasio\" y category_origin NULL (UNKNOWN)"
  - "1 gasto con source RECURRING y origen UNKNOWN en \"Gimnasio\""
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Los 3 gastos MANUAL cuentan; el RECURRING no"
  - "Se sugiere la regla hacia \"Gimnasio\" con apoyo 3"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-006 — Clasificaciones anteriores al motor de reglas cuentan como evidencia

## Intención

Pregunta 1 de design.md (recomendación (a)); revisar si el owner elige otra opción.

## Escenario

```gherkin
Dados gastos anteriores al motor con origen desconocido
Cuando calculo sugerencias
Entonces cuentan los registrados a mano
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
