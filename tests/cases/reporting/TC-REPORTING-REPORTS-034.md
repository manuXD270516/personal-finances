---
id: TC-REPORTING-REPORTS-034
title: "Sin tasa de una moneda la descomposición queda incompleta y no atribuye la diferencia a otro componente"
spec: reporting/net-worth
related_specs: []
requirement: "Descomposición incompleta por falta de tasa"
scenario: "Bitcoin sin tasa al cierre"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-FX-006"]
nfr: []
invariants: ["INV-031"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["net-worth", "missing-rate"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Wallet BTC\" 0.01000000 BTC sin tasa BTC/BOB vigente al 2026-10-31"
input: {}
steps:
  - "Descomponer el cambio de 2026-10"
expected_result:
  - "complete = false"
  - "unvalued = [0.01000000 BTC]"
  - "Sin revalorización para BTC y sin residuo en otro componente"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-034 — Sin tasa de una moneda la descomposición queda incompleta y no atribuye la diferencia a otro componente

## Intención

Nunca 1:1 ni residuos atribuidos sin base.

## Escenario

```gherkin
Dado 0.01000000 BTC sin tasa al cierre
Cuando se descompone 2026-10
Entonces la descomposición se marca incompleta e informa el BTC sin valorar
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
