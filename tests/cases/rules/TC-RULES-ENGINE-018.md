---
id: TC-RULES-ENGINE-018
title: "Recategorizar por regla no cambia saldos ni crea asientos"
spec: rules/rule-engine
related_specs: []
requirement: "Las reglas no cambian datos financieros"
scenario: "Recategorizar un gasto posteado"
requirement_status: provisional
fr: ["FR-RULES-005", "FR-TRANSACTIONS-028"]
nfr: []
invariants: ["INV-004"]
priority: critical
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
  - "Cuenta \"Banco BOB\" con saldo 4000.00 BOB después de un gasto posteado de 185.40 BOB \"sin categoría\""
input: {"apply":"regla Supermercado sobre el gasto"}
steps:
  - "Aplicar la regla con applyRuleDryRun"
expected_result:
  - "Saldo de Banco BOB = 4000.00 BOB"
  - "Cantidad de asientos sin cambio"
created: 2026-10-29
updated: 2026-10-29
---

# TC-RULES-ENGINE-018 — Recategorizar por regla no cambia saldos ni crea asientos

## Intención

La clasificación no impacta el ledger.

## Escenario

```gherkin
Dado un gasto posteado de 185.40 BOB
Cuando una regla cambia su categoría
Entonces el saldo sigue en 4000.00 BOB
  Y no hay asiento nuevo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
