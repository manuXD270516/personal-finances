---
id: TC-RULES-ENGINE-020
title: "Empate de prioridad se resuelve por antigüedad y el resultado es reproducible"
spec: rules/rule-engine
related_specs: []
requirement: "Prioridad y resolución acumulativa determinista"
scenario: "Empate de prioridad"
requirement_status: confirmed
fr: ["FR-RULES-006"]
nfr: []
invariants: []
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/rule-evaluator.test.ts
  - packages/contexts/rules/test/integration/pg-rules.int.test.ts
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
input: {"rules":"A y B con prioridad 50, A creada antes"}
steps:
  - "Evaluar 100 veces con las reglas cargadas en orden aleatorio"
  - "PBT: para conjuntos aleatorios de reglas y sujetos, el resultado no depende del orden de carga"
expected_result:
  - "Siempre gana la categoría de A"
  - "La propiedad se cumple (timeout explícito)"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-020 — Empate de prioridad se resuelve por antigüedad y el resultado es reproducible

## Intención

Orden total (priority, created_at, id) y determinismo.

## Escenario

```gherkin
Dadas A y B de prioridad 50, A más antigua
Cuando evalúo 100 veces en cualquier orden
Entonces siempre gana A
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
