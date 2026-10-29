---
id: TC-RULES-ENGINE-021
title: "stopProcessing impide evaluar reglas posteriores"
spec: rules/rule-engine
related_specs: []
requirement: "Detener el procesamiento"
scenario: "Regla que detiene la evaluación"
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
input: {"rules":"Restaurantes (10, stopProcessing) y Comida (20)"}
steps:
  - "Evaluar POLLOS COPACABANA"
expected_result:
  - "category = Restaurantes"
  - "Sin etiqueta comida"
  - "matched = [Restaurantes]"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-021 — stopProcessing impide evaluar reglas posteriores

## Intención

FR-RULES-006 stopProcessing.

## Escenario

```gherkin
Dada Restaurantes con detener procesamiento
Cuando evalúo POLLOS COPACABANA
Entonces no se agrega la etiqueta comida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
