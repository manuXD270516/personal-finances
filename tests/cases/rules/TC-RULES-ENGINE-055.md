---
id: TC-RULES-ENGINE-055
title: "Cada split importado registra el origen de su categoría"
spec: transactions/transaction-recording
related_specs: ["rules/rule-engine"]
requirement: "Origen de la clasificación de cada split"
scenario: "Orígenes de un import"
requirement_status: confirmed
fr: ["FR-RULES-010", "FR-CLASSIFICATION-011"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
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
  - "Cuenta \"Banco BOB\"; contraparte \"Farmacorp\" con categoría por defecto \"Farmacia\""
input: {"rows":["185.40 BOB regla Supermercado v1","60.00 BOB Farmacorp","300.00 BOB sin categoría"]}
steps:
  - "recordBatch con ImportedClassificationDto para las tres filas"
expected_result:
  - "Orígenes RULE (Supermercado, 1), COUNTERPARTY_DEFAULT y SYSTEM_DEFAULT"
  - "El saldo de Banco BOB baja 545.40 BOB"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-055 — Cada split importado registra el origen de su categoría

## Intención

Origen por split sin efecto en el ledger.

## Escenario

```gherkin
Dado un import con tres gastos
Cuando se persisten
Entonces cada split tiene su origen
  Y el saldo baja 545.40 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
