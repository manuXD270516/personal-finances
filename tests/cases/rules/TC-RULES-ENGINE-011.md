---
id: TC-RULES-ENGINE-011
title: "Un patrón patológico termina en tiempo lineal"
spec: rules/rule-engine
related_specs: []
requirement: "Expresiones regulares acotadas"
scenario: "Patrón patológico acotado"
requirement_status: provisional
fr: ["FR-RULES-003"]
nfr: ["NFR-SEC-009"]
invariants: []
priority: high
type: security
level: security
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
input: {"pattern":"(a|aa)*b","text":"500 letras a"}
steps:
  - "Evaluar la condición con timeout explícito del test"
expected_result:
  - "Sin coincidencia"
  - "Duración < 50 ms"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-011 — Un patrón patológico termina en tiempo lineal

## Intención

Sin ReDoS: la garantía es estructural, no un timeout de reloj.

## Escenario

```gherkin
Dada la regex (a|aa)*b
Cuando la evalúo contra 500 letras a
Entonces termina en menos de 50 ms sin coincidencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
