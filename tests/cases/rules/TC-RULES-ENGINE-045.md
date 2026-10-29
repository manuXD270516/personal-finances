---
id: TC-RULES-ENGINE-045
title: "Correcciones y anulaciones bajan la cobertura"
spec: rules/rule-engine
related_specs: []
requirement: "Cobertura de clasificación por reglas"
scenario: "Corrección posterior y anulaciones"
requirement_status: provisional
fr: ["FR-RULES-010"]
nfr: []
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"corrected":3,"voided":2}
steps:
  - "Corregir a mano 3 de las 148"
  - "Anular 2 de las 20 sin categoría"
  - "GET W/rules/coverage"
expected_result:
  - "total 198; RULE 145"
  - "ruleCoverage \"0.7323\" (HALF_EVEN a 4 decimales)"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-045 — Correcciones y anulaciones bajan la cobertura

## Intención

Solo cuentan las clasificaciones de reglas vigentes (pregunta 2).

## Escenario

```gherkin
Dada la cobertura de 0.7400
Cuando corrijo 3 y anulo 2 sin categoría
Entonces el cociente es 0.7323
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
