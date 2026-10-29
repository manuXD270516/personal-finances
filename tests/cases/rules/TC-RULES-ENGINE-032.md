---
id: TC-RULES-ENGINE-032
title: "La edición del usuario en la vista previa queda con origen manual"
spec: rules/rule-engine
related_specs: ["imports/import-pipeline"]
requirement: "Evaluación sin efectos en la importación"
scenario: "El usuario corrige una fila"
requirement_status: provisional
fr: ["FR-RULES-009", "FR-RULES-010"]
nfr: []
invariants: []
priority: high
type: integration
level: import
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
input: {"edit":"TIGO MONEY RECARGA ⇒ Internet"}
steps:
  - "Cambiar la categoría de la fila"
  - "Aprobar y esperar la persistencia"
expected_result:
  - "Transacción Tigo: Internet con categoryOrigin MANUAL"
  - "Transacción Hipermaxi: Supermercado con RULE Supermercado v1"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-032 — La edición del usuario en la vista previa queda con origen manual

## Intención

Lo aprobado es lo que se persiste, con su origen.

## Escenario

```gherkin
Dada la vista previa con dos filas clasificadas
Cuando cambio Tigo a Internet y apruebo
Entonces Tigo queda con origen manual
  Y Hipermaxi con origen en la regla
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
