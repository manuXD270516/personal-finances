---
id: TC-REPORTING-DASHBOARD-002
title: "El dinero disponible consolida cuentas líquidas en BOB con la tasa paralela del provider, su fuente y antigüedad"
spec: reporting/dashboard
related_specs: ["fx/market-rates","fx/market-rate-providers"]
requirement: "Dinero disponible consolidado en la moneda de reporte"
scenario: "BOB y USDT consolidados"
requirement_status: confirmed
fr: ["FR-REPORTING-003","FR-REPORTING-002","FR-FX-006","FR-FX-010","FR-FX-014","FR-ACCOUNTS-011"]
nfr: []
invariants: ["INV-020"]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["dashboard","liquid-balance","fx"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 salvo indicación"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas, incluidas en patrimonio)"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo con vigencia 2026-09-30T21:53:07Z (preferencia PARALLEL)"
  - "Cuenta de inversión no líquida con 5000.00 BOB"
input: {"asOf":"2026-09-30T18:00:00-04:00"}
steps:
  - "Calcular el dinero disponible consolidado"
expected_result:
  - "Consolidado = 805.50 + 50.000000 × 12.02 = 1406.50 BOB"
  - "ratesUsed: USDT/BOB 12.02 PARALLEL, provider PARALELO_BO, selection PRIMARY, asOf 2026-09-30T21:53:07Z, ageSeconds 413 (6 min), stale false"
  - "meta.attributions incluye \"Fuente: paralelo.bo\" (https://paralelo.bo, CC BY 4.0) y la UI la muestra junto a la tasa"
  - "La cuenta de inversión no suma"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-DASHBOARD-002 — El dinero disponible consolida cuentas líquidas en BOB con la tasa paralela del provider, su fuente y antigüedad

## Intención

Q1: el número más mirado del producto debe declarar con qué tasa se calculó, de qué fuente viene y cuán reciente es (docs/31 D29).

## Escenario

```gherkin
Dadas cuentas líquidas con 805.50 BOB y 50.000000 USDT y USDT/BOB PARALLEL 12.02 de paralelo.bo de las 21:53:07Z
Cuando consulto el dinero disponible el 2026-09-30 a las 18:00 (La Paz)
Entonces veo 1406.50 BOB
  Y la tasa 12.02 PARALLEL con "Fuente: paralelo.bo" y antigüedad de 6 minutos
```

## Notas

- Datos ficticios salvo la tasa (valor observado en paralelo.bo el 2026-10-02, usado como fixture); fechas fijas con `FixedClock` (TZ America/La_Paz).
- Recalculado el 2026-10-02 (antes: USDT/BOB P2P manual 6.95 → 1153.00 BOB).
