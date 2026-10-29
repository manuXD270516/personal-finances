---
id: TC-RULES-ENGINE-007
title: "Contains ignora acentos, mayúsculas y espacios repetidos"
spec: rules/rule-engine
related_specs: []
requirement: "Operadores y comparación de texto"
scenario: "Texto sin acentos ni mayúsculas"
requirement_status: provisional
fr: ["FR-RULES-003"]
nfr: []
invariants: []
priority: high
type: property
level: property
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
input: {"condition":"DESCRIPTION contains cafe","text":"PAGO QR  CAFÉ Alexander"}
steps:
  - "Evaluar la condición"
  - "PBT: para todo texto t, contains(normalize(t)) es invariante ante mayúsculas y diacríticos"
expected_result:
  - "La condición se cumple"
  - "La propiedad se cumple en 500 corridas"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-007 — Contains ignora acentos, mayúsculas y espacios repetidos

## Intención

Misma normalización que Classification (`normalizeText` en shared-kernel).

## Escenario

```gherkin
Dada la condición "descripción contiene cafe"
Cuando evalúo "PAGO QR  CAFÉ Alexander"
Entonces se cumple
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
