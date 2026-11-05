---
id: TC-RULES-SUGGEST-013
title: "Un patrón ya cubierto por una regla activa no se sugiere"
spec: rules/rule-engine
related_specs: []
requirement: "Patrones ya cubiertos o en conflicto con reglas existentes"
scenario: "Patrón ya cubierto"
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
  - "4 gastos \"TIGO MONEY RECARGA\" con origen MANUAL en \"Telefonía\""
  - "Regla activa \"Tigo\": DESCRIPTION contains `tigo money` ⇒ Telefonía (solo disparador IMPORT)"
input: {}
steps:
  - "Calcular sugerencias"
expected_result:
  - "Ninguna sugerencia para el patrón (la regla cubre toda la evidencia con cualquier disparador)"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-013 — Un patrón ya cubierto por una regla activa no se sugiere

## Intención

No sugerir lo que ya existe.

## Escenario

```gherkin
Dada una regla que ya cubre el patrón
Cuando calculo sugerencias
Entonces no se repite
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
