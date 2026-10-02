---
id: TC-REPORTING-KPI-003
title: "Los flujos en USD se consolidan con la tasa de su fecha y no cambian con tasas posteriores"
spec: reporting/dashboard
related_specs: ["fx/market-rates","fx/market-rate-providers"]
requirement: "Flujos convertidos con la tasa de su fecha"
scenario: "Gasto en USD y en BOB"
requirement_status: confirmed
fr: ["FR-REPORTING-004","FR-FX-006","FR-FX-013"]
nfr: []
invariants: ["INV-012","INV-020"]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["kpi","multi-currency","conv_t"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
  - "USD/BOB PARALLEL 11.96 de paralelo.bo (histórico diario) vigente al cierre del 2026-09-10 (preferencia PARALLEL)"
input: {"expenses":[{"amount":"20.00 USD","date":"2026-09-10"},{"amount":"100.00 BOB","date":"2026-09-12"}],"later_rate":{"pair":"USD/BOB","type":"PARALLEL","value":"12.02","asOf":"2026-10-02T08:53:07.532Z"}}
steps:
  - "Calcular gastos de septiembre por moneda y consolidados"
  - "Registrar la tasa del provider del 2026-10-02 y recalcular septiembre"
expected_result:
  - "Por moneda: 20.00 USD y 100.00 BOB"
  - "Consolidado: 20.00 × 11.96 + 100.00 = 339.20 BOB"
  - "Tras la tasa nueva, septiembre sigue en 339.20 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-KPI-003 — Los flujos en USD se consolidan con la tasa de su fecha y no cambian con tasas posteriores

## Intención

docs/14 §5: los flujos se valoran al momento del hecho; un gasto de septiembre no cambia porque el USD subió en octubre.

## Escenario

```gherkin
Dado un gasto de 20.00 USD el 2026-09-10 con USD/BOB PARALLEL 11.96 y otro de 100.00 BOB
Cuando consulto los gastos de septiembre
Entonces el consolidado es 339.20 BOB
```

## Notas

- Datos ficticios (el valor 11.96 del histórico es de ejemplo); fechas fijas con `FixedClock` (TZ America/La_Paz).
- Recalculado el 2026-10-02 (antes: USD/BOB OFFICIAL 6.96 → 239.20 BOB).
