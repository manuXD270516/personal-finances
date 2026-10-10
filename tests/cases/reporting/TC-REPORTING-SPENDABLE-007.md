---
id: TC-REPORTING-SPENDABLE-007
title: "Un faltante en BOB con excedente en USD se indica por moneda con la sugerencia de convertir"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Disponible por moneda y consolidado"
scenario: "Faltante en BOB con excedente en USD"
requirement_status: provisional
fr: ["FR-REPORTING-001", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "fx", "shortfall"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Líquido 2000.00 BOB con 2200.00 BOB comprometidos; líquido 100.00 USD sin compromisos"
  - "Tasa USD/BOB 12.00"
input: {}
steps:
  - "Calcular el disponible"
expected_result:
  - "byCurrency −200.00 BOB y 100.00 USD; consolidated 1000.00 BOB"
  - "shortfalls [{currency: BOB, amount: 200.00}] y status OK"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-007 — Un faltante en BOB con excedente en USD se indica por moneda con la sugerencia de convertir

## Intención

docs/14 §4.2: "necesitas convertir".

## Escenario

```gherkin
Dados −200.00 BOB y 100.00 USD disponibles con tasa 12.00
Cuando consulto el disponible
Entonces el consolidado es 1000.00 BOB
  Y se indica que en BOB faltan 200.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
