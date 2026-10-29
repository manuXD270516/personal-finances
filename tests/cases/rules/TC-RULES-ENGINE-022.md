---
id: TC-RULES-ENGINE-022
title: "Una regla con stopProcessing que no coincide no corta la cadena"
spec: rules/rule-engine
related_specs: []
requirement: "Detener el procesamiento"
scenario: "Regla que detiene pero no coincide"
requirement_status: provisional
fr: ["FR-RULES-006"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
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
input: {"rules":"R10 stopProcessing que no coincide, R20 que coincide"}
steps:
  - "Evaluar"
expected_result:
  - "Se aplican las acciones de R20"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-022 — Una regla con stopProcessing que no coincide no corta la cadena

## Intención

stopProcessing solo actúa al coincidir.

## Escenario

```gherkin
Dada R10 que detiene pero no coincide
Cuando evalúo
Entonces R20 aplica sus acciones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
