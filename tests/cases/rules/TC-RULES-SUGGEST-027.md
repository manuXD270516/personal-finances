---
id: TC-RULES-SUGGEST-027
title: "Sugerencias deterministas ante cualquier orden de la evidencia"
spec: rules/rule-engine
related_specs: []
requirement: "Sugerencia de reglas por clasificaciones manuales repetidas"
scenario: null
requirement_status: provisional
fr: ["FR-RULES-011"]
nfr: []
invariants: []
priority: medium
type: property
level: property
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
  - "Generador de evidencia aleatoria (patrones, kinds y categorías)"
input: {"corridas":200}
steps:
  - "Ejecutar el miner con la evidencia y con permutaciones"
expected_result:
  - "Mismas sugerencias, huellas y orden"
  - "Ninguna sugerencia con apoyo < 3 o confianza < 0.8000"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-027 — Sugerencias deterministas ante cualquier orden de la evidencia

## Intención

Determinismo (PBT con timeout explícito).

## Escenario

```gherkin
Dada evidencia aleatoria
Cuando la permuto
Entonces las sugerencias no cambian
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
