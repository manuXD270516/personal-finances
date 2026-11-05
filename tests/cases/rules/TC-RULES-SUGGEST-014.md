---
id: TC-RULES-SUGGEST-014
title: "Conflicto con una regla existente propone una prioridad anterior"
spec: rules/rule-engine
related_specs: []
requirement: "Patrones ya cubiertos o en conflicto con reglas existentes"
scenario: "Corrección de una regla existente"
requirement_status: provisional
fr: ["FR-RULES-011","FR-RULES-006"]
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
  - "Datos de TC-RULES-SUGGEST-005"
  - "La regla \"Supermercado\" tiene prioridad 100 y coincide con los 3 gastos"
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "La sugerencia hacia \"Farmacia\" lista el conflicto con \"Supermercado\" en 3 transacciones"
  - "Prioridad propuesta 99"
  - "Con la regla en prioridad 0, prioridad propuesta 0 y aviso CANNOT_OUTRANK"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-014 — Conflicto con una regla existente propone una prioridad anterior

## Intención

Con primer escritor gana (D333), la nueva regla debe evaluarse antes.

## Escenario

```gherkin
Dada una regla que clasifica distinto
Cuando calculo sugerencias
Entonces se informa el conflicto y la prioridad 99
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
