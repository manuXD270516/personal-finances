---
id: TC-RULES-ENGINE-004
title: "La condición de monto compara exacto y solo en su moneda"
spec: rules/rule-engine
related_specs: []
requirement: "Campos de condición"
scenario: "Monto entre dos valores en bolivianos"
requirement_status: confirmed
fr: ["FR-RULES-002", "FR-RULES-003"]
nfr: []
invariants: ["INV-001"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/rules/src/domain/condition.test.ts
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
input: {"condition":"AMOUNT between 100.00 y 500.00 BOB","subjects":["250.00 BOB","500.00 BOB","500.01 BOB","250.00 USD"]}
steps:
  - "Evaluar la condición sobre los cuatro gastos"
expected_result:
  - "Cumplen 250.00 BOB y 500.00 BOB"
  - "No cumplen 500.01 BOB ni 250.00 USD"
  - "Ningún monto se convierte a number"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-004 — La condición de monto compara exacto y solo en su moneda

## Intención

FR-RULES-002: el monto exige moneda y se compara como Decimal (INV-001).

## Escenario

```gherkin
Dada la condición "monto entre 100.00 BOB y 500.00 BOB"
Cuando evalúo 250.00 BOB, 500.00 BOB, 500.01 BOB y 250.00 USD
Entonces solo cumplen 250.00 BOB y 500.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
