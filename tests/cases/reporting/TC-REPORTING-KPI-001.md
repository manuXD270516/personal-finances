---
id: TC-REPORTING-KPI-001
title: "Los ingresos del mes excluyen transferencias, conversiones y saldos iniciales"
spec: reporting/dashboard
related_specs: ["transactions/transfers","transactions/conversions"]
requirement: "Ingresos del mes"
scenario: "Solo el salario cuenta como ingreso"
requirement_status: confirmed
fr: ["FR-REPORTING-004","FR-REPORTING-002"]
nfr: []
invariants: ["INV-009","INV-031"]
priority: critical
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["kpi","income"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
input: {"transactions":[{"kind":"INCOME","amount":"8000.00 BOB","date":"2026-09-05","category":"Salario"},{"kind":"TRANSFER","amount":"1000.00 BOB","date":"2026-09-06"},{"kind":"CONVERSION","source":"100.000000 USDT","target":"685.00 BOB","fee":"5.00 BOB","date":"2026-09-30"},{"kind":"OPENING_BALANCE","amount":"500.00 BOB","date":"2026-09-01"}]}
steps:
  - "Calcular Income(2026-09) sobre los postings del fixture"
expected_result:
  - "Ingresos = 8000.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-KPI-001 — Los ingresos del mes excluyen transferencias, conversiones y saldos iniciales

## Intención

docs/14 §4: transferir o convertir no es ganar dinero.

## Escenario

```gherkin
Dado un salario de 8000.00 BOB, una transferencia de 1000.00 BOB, una conversión a 685.00 BOB y un saldo inicial de 500.00 BOB en septiembre
Cuando calculo los ingresos de septiembre
Entonces son 8000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
