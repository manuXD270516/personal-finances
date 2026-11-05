---
id: TC-RULES-SUGGEST-005
title: "Correcciones manuales de una regla cuentan como evidencia"
spec: rules/rule-engine
related_specs: []
requirement: "Evidencia de clasificación manual"
scenario: "Correcciones de una regla cuentan"
requirement_status: provisional
fr: ["FR-RULES-011","FR-RULES-010"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
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
  - "La regla \"Supermercado\" puso 3 gastos \"FARMACORP SUC 3\" en \"Supermercado\""
  - "El usuario los corrigió a mano a \"Farmacia\" (origen MANUAL)"
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Los 3 gastos son evidencia de \"Farmacia\""
  - "Se sugiere la regla hacia \"Farmacia\""
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-005 — Correcciones manuales de una regla cuentan como evidencia

## Intención

La recategorización manual es la señal que pide FR-RULES-011.

## Escenario

```gherkin
Dadas 3 correcciones de una regla
Cuando calculo sugerencias
Entonces se sugiere la categoría corregida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
