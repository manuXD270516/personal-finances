---
id: TC-RULES-ENGINE-023
title: "Una categoría archivada omite la acción y la regla requiere atención"
spec: rules/rule-engine
related_specs: []
requirement: "Referencias y acciones no aplicables"
scenario: "Categoría archivada después de crear la regla"
requirement_status: provisional
fr: ["FR-RULES-005", "FR-CLASSIFICATION-002"]
nfr: []
invariants: ["INV-019"]
priority: high
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
  - "Regla \"Supermercado\" v1 (prioridad 100): descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta \"hogar\", contraparte \"Hipermaxi\""
input: {"archive":"Supermercado"}
steps:
  - "Archivar la categoría Supermercado"
  - "Evaluar HIPERMAXI SUC 12"
  - "GET W/rules"
expected_result:
  - "skipped con reason RULE_ACTION_TARGET_ARCHIVED para SET_CATEGORY"
  - "Etiqueta y contraparte se aplican"
  - "La regla aparece con needsAttention = true"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-023 — Una categoría archivada omite la acción y la regla requiere atención

## Intención

Las categorías nunca se borran (INV-019); la regla no falla, avisa.

## Escenario

```gherkin
Dada la regla Supermercado y la categoría archivada
Cuando evalúo HIPERMAXI SUC 12
Entonces la acción de categoría se omite
  Y la regla requiere atención
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
