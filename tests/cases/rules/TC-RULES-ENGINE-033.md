---
id: TC-RULES-ENGINE-033
title: "Editar una regla después de la vista previa no cambia lo aprobado"
spec: rules/rule-engine
related_specs: ["imports/import-pipeline"]
requirement: "Evaluación sin efectos en la importación"
scenario: "La regla cambia antes de aprobar"
requirement_status: confirmed
fr: ["FR-RULES-009", "FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: integration
level: import
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/application/evaluation.test.ts
  - packages/contexts/transactions/src/application/rule-classification.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\", \"Restaurantes\", \"Telefonía\", \"Hogar\", \"Internet\", \"Regalos\" y de ingreso \"Reembolsos varios\"; etiquetas \"hogar\" y \"comida\"; contraparte \"Hipermaxi\""
input: {"edit":"Supermercado pasa a v2 tras la vista previa"}
steps:
  - "Previsualizar"
  - "Editar la regla"
  - "Aprobar sin reevaluar"
  - "Variante: reevaluar antes de aprobar"
expected_result:
  - "La transacción conserva lo mostrado con origen v1"
  - "Variante: la vista previa muestra v2"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-033 — Editar una regla después de la vista previa no cambia lo aprobado

## Intención

Sin cambios silenciosos de lo aprobado.

## Escenario

```gherkin
Dada una vista previa con Supermercado v1
Cuando la regla pasa a v2 y apruebo
Entonces la transacción conserva el origen v1
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
