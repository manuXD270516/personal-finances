---
id: TC-REPORTING-KPI-004
title: "El ahorro es ingresos menos gastos y la tasa de ahorro no se define sin ingresos"
spec: reporting/dashboard
related_specs: []
requirement: "Ahorro del mes y tasa de ahorro"
scenario: "Mes con ingresos"
requirement_status: confirmed
fr: ["FR-REPORTING-002"]
nfr: []
invariants: ["INV-031"]
priority: high
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["kpi","savings"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
input: {"case_1":{"income":"8000.00 BOB","expenses":"1305.00 BOB"},"case_2":{"income":"0.00 BOB","expenses":"300.00 BOB"}}
steps:
  - "Calcular ahorro y tasa de ahorro de cada caso"
expected_result:
  - "Caso 1: ahorro 6695.00 BOB; tasa 83.7 % (6695 / 8000 = 0.836875)"
  - "Caso 2: ahorro −300.00 BOB; tasa no definida (savingsRate null, UI \"—\")"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-KPI-004 — El ahorro es ingresos menos gastos y la tasa de ahorro no se define sin ingresos

## Intención

Q6: evitar 0 % o −∞ engañosos cuando no hubo ingresos.

## Escenario

```gherkin
Dados ingresos de 8000.00 BOB y gastos de 1305.00 BOB
Cuando calculo el ahorro
Entonces es 6695.00 BOB con tasa de ahorro 83.7 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
