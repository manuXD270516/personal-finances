---
id: TC-GOALS-SAVINGS-002
title: "El alta de una meta rechaza objetivo con más decimales, cero, moneda no habilitada, fechas invertidas y nombre repetido"
spec: goals/savings-goals
related_specs: []
requirement: "Meta de ahorro con tipo, objetivo, fechas y cuentas vinculadas"
scenario: "Objetivo con más decimales que su moneda"
requirement_status: provisional
fr: ["FR-GOALS-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "validation"]
error_code: AMOUNT_SCALE_EXCEEDED
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "Existe la meta no archivada \"Laptop\""
  - "EUR no está habilitada en W1"
input: {"cases": [{"target": "9000.005 BOB", "expect": "AMOUNT_SCALE_EXCEEDED"}, {"target": "0.00 BOB", "expect": "AMOUNT_NOT_POSITIVE"}, {"target": "500.00 EUR", "expect": "CURRENCY_NOT_ENABLED"}, {"startDate": "2026-10-01", "targetDate": "2026-09-30", "expect": "VALIDATION_FAILED"}, {"name": "laptop", "expect": "NAME_TAKEN"}]}
steps:
  - "Crear una meta por cada caso de input"
expected_result:
  - "Cada alta se rechaza con el código indicado (problem+json)"
  - "No se crea ninguna meta ni auditoría de creación"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-002 — El alta de una meta rechaza objetivo con más decimales, cero, moneda no habilitada, fechas invertidas y nombre repetido

## Intención

Ningún objetivo con escala inválida, no positivo o en una moneda no habilitada debe entrar al dominio (INV-001/002).

## Escenario

```gherkin
Cuando el EDITOR crea "Laptop" por 9000.005 BOB
Entonces se rechaza con AMOUNT_SCALE_EXCEEDED
  Y no se crea la meta
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
