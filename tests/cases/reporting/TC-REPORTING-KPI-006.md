---
id: TC-REPORTING-KPI-006
title: "El top-N de categorías ordena por gasto neto descendente con desempate por nombre"
spec: reporting/dashboard
related_specs: []
requirement: "Principales categorías de gasto del mes"
scenario: "Top 2 categorías"
requirement_status: confirmed
fr: ["FR-REPORTING-004"]
nfr: []
invariants: []
priority: medium
type: unit
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/kpi-calculator.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["kpi","categories"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
input: {"categories":{"Supermercado":"1200.00 BOB","Restaurantes":"100.00 BOB","Transporte":"80.00 BOB","Fees":"5.00 BOB"},"topCategories":2,"tie_case":{"Cine":"40.00 BOB","Agua":"40.00 BOB"}}
steps:
  - "Pedir top 2"
  - "Pedir top 6 incluyendo el caso de empate"
  - "Pedir top 21"
expected_result:
  - "Top 2: Supermercado 1200.00 BOB, Restaurantes 100.00 BOB"
  - "Empate: Agua antes que Cine"
  - "topCategories = 21 se rechaza con 400 VALIDATION_FAILED (máximo 20)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-REPORTING-KPI-006 — El top-N de categorías ordena por gasto neto descendente con desempate por nombre

## Intención

Q3/Q7: mostrar dónde se va el dinero de forma estable y reproducible.

## Escenario

```gherkin
Dadas Supermercado 1200.00, Restaurantes 100.00, Transporte 80.00 y Fees 5.00 BOB
Cuando pido las 2 principales categorías
Entonces veo Supermercado y Restaurantes en ese orden
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
