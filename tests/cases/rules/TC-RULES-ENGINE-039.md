---
id: TC-RULES-ENGINE-039
title: "Una regla inactiva no se evalúa"
spec: rules/rule-engine
related_specs: []
requirement: "Activar, desactivar y archivar reglas"
scenario: "Regla desactivada"
requirement_status: provisional
fr: ["FR-RULES-001"]
nfr: []
invariants: []
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
input: {"action":"disable"}
steps:
  - "POST W/rules/{id}/disable con If-Match"
  - "Evaluar HIPERMAXI SUC 12"
expected_result:
  - "Fila sin categoría y sin regla"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-039 — Una regla inactiva no se evalúa

## Intención

Estado activo/inactivo de FR-RULES-001.

## Escenario

```gherkin
Dada la regla Supermercado desactivada
Cuando previsualizo HIPERMAXI SUC 12
Entonces queda sin categoría
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
