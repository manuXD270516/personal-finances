---
id: TC-REPORTING-KPI-002
title: "Los gastos del mes incluyen fees de conversión, restan reembolsos y excluyen pagos de tarjeta"
spec: reporting/dashboard
related_specs: ["transactions/conversions","transactions/transfers"]
requirement: "Gastos del mes netos de reembolsos"
scenario: "Gastos con reembolso, fee y pago de tarjeta"
requirement_status: confirmed
fr: ["FR-REPORTING-004","FR-TRANSACTIONS-016","FR-TRANSACTIONS-023"]
nfr: []
invariants: ["INV-009"]
priority: critical
type: unit
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
  - packages/contexts/reporting/src/application/report-summary.golden.test.ts
  - packages/contexts/reporting/src/domain/kpi-calculator.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["kpi","expenses","refund"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
input: {"transactions":[{"kind":"EXPENSE","amount":"1200.00 BOB","category":"Supermercado"},{"kind":"EXPENSE","amount":"300.00 BOB","category":"Restaurantes"},{"kind":"REFUND","amount":"200.00 BOB","category":"Restaurantes"},{"kind":"CONVERSION","fee":"5.00 BOB"},{"kind":"CARD_PAYMENT","amount":"400.00 BOB"}],"variant":{"Restaurantes":{"expense":"50.00 BOB","refund":"80.00 BOB"}}}
steps:
  - "Calcular Expenses(2026-09)"
  - "Calcular el neto por categoría de la variante"
expected_result:
  - "Gastos = 1200.00 + 300.00 − 200.00 + 5.00 = 1305.00 BOB"
  - "El pago de tarjeta de 400.00 BOB no suma"
  - "Variante: Restaurantes = −30.00 BOB mostrado como neto negativo"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-KPI-002 — Los gastos del mes incluyen fees de conversión, restan reembolsos y excluyen pagos de tarjeta

## Intención

Q3: el gasto real del mes; un reembolso no es ingreso y un pago de tarjeta no es gasto nuevo.

## Escenario

```gherkin
Dados gastos de 1200.00 y 300.00 BOB, un reembolso de 200.00 BOB, un fee de conversión de 5.00 BOB y un pago de tarjeta de 400.00 BOB
Cuando calculo los gastos de septiembre
Entonces son 1305.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
