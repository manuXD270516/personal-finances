---
id: TC-REPORTING-DASHBOARD-004
title: "Los consolidados se redondean HALF_EVEN solo al presentar, agregando por moneda antes de convertir"
spec: reporting/dashboard
related_specs: []
requirement: "Redondeo solo al presentar"
scenario: "Dos wallets USDT"
requirement_status: confirmed
fr: ["FR-REPORTING-003"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-020","INV-001"]
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["dashboard","rounding","fast-check"]
error_code: null
preconditions:
  - "Dos cuentas líquidas con 33.333333 USDT cada una"
  - "USDT/BOB PARALLEL 12.02"
input: {"balances":["33.333333 USDT","33.333333 USDT"],"rate":"12.02","numRuns_pr":100}
steps:
  - "Consolidar las dos cuentas"
  - "Propiedad: para saldos aleatorios, consolidado = round(Σ saldos × tasa)"
expected_result:
  - "Consolidado = 801.33 BOB (66.666666 × 12.02 = 801.33332532)"
  - "No 801.34 BOB (suma de 400.67 redondeados por cuenta)"
  - "El resultado es determinista"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-DASHBOARD-004 — Los consolidados se redondean HALF_EVEN solo al presentar, agregando por moneda antes de convertir

## Intención

NFR-DATA-002: redondear en pasos intermedios introduce deriva de centavos.

## Escenario

```gherkin
Dadas dos wallets con 33.333333 USDT y USDT/BOB 12.02
Cuando consolido en BOB
Entonces obtengo 801.33 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
