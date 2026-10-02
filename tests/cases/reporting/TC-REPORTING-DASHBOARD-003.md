---
id: TC-REPORTING-DASHBOARD-003
title: "Saldos sin tasa vigente se muestran sin convertir y el consolidado queda incompleto"
spec: reporting/dashboard
related_specs: ["fx/market-rates","fx/market-rate-providers"]
requirement: "Montos sin tasa vigente se muestran sin convertir"
scenario: "BTC sin tasa"
requirement_status: confirmed
fr: ["FR-REPORTING-001","FR-FX-004","FR-FX-006"]
nfr: []
invariants: []
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["dashboard","missing-rate"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo con vigencia 2026-09-30T21:53:07Z"
  - "\"Wallet BTC\" 0.01000000 BTC sin tasa BTC/BOB"
  - "Variante: la última USDT/BOB de cualquier origen (provider o manual) es del 2026-09-20"
input: {"asOf":"2026-09-30","window_days":7}
steps:
  - "Consultar el resumen"
  - "Repetir con la variante de tasa USDT vencida"
expected_result:
  - "Consolidado 1406.50 BOB con complete = false y unconverted = [0.01000000 BTC] y advertencia de registrar la tasa"
  - "Variante: consolidado 805.50 BOB, complete = false, unconverted = [0.01000000 BTC, 50.000000 USDT]"
  - "Nunca se usa 1:1 ni una tasa fuera de la ventana"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-DASHBOARD-003 — Saldos sin tasa vigente se muestran sin convertir y el consolidado queda incompleto

## Intención

docs/14 §5: un número parcial nunca debe parecer completo.

## Escenario

```gherkin
Dado "Wallet BTC" con 0.01000000 BTC y ninguna tasa BTC/BOB
Cuando consulto el dinero disponible
Entonces el consolidado es 1406.50 BOB marcado como incompleto
  Y 0.01000000 BTC se muestra sin convertir con advertencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- Recalculado el 2026-10-02 con la tasa PARALLEL del provider (antes 1153.00 BOB con 6.95).
