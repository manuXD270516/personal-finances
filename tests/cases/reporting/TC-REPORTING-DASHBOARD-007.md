---
id: TC-REPORTING-DASHBOARD-007
title: "Con providers caídos el dinero disponible usa la última tasa conocida marcada obsoleta o una manual más reciente"
spec: reporting/dashboard
related_specs: ["fx/market-rate-providers","fx/market-rates"]
requirement: "Valoración de USD y USDT con fallback a la última tasa conocida o manual"
scenario: "Providers caídos con última tasa obsoleta"
requirement_status: confirmed
fr: ["FR-REPORTING-003","FR-FX-010","FR-FX-006"]
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
tags: ["dashboard","liquid-balance","fx","provider","staleness"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-09-30T18:00:00-04:00 (22:00:00Z)"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, líquidas)"
  - "Preferencia USDT/BOB = PARALLEL; FX_STALE_AFTER_PARALLEL = 60m; ventana 7 días"
  - "Providers fallan desde 2026-09-30T14:00:00Z; última tasa de provider: USDT/BOB PARALLEL 12.02 de paralelo.bo con vigencia 2026-09-30T13:53:07Z"
input: {"asOf":"2026-09-30T18:00:00-04:00","variant_manual_rate":{"pair":"USDT/BOB","type":"P2P","value":"11.98","asOf":"2026-09-30T20:00:00Z","sourceLabel":"Casa de cambio centro"}}
steps:
  - "Consultar el resumen sin tasas manuales posteriores"
  - "Variante: registrar la tasa manual USDT/BOB P2P 11.98 de las 20:00:00Z y consultar de nuevo"
expected_result:
  - "Consolidado 1406.50 BOB (805.50 + 50.000000 × 12.02) con complete = true"
  - "ratesUsed: USDT/BOB 12.02, provider PARALELO_BO, selection LAST_KNOWN_STALE, stale true, ageSeconds 29213 (8 h); la UI la marca como obsoleta con su antigüedad y \"Fuente: paralelo.bo\""
  - "Variante: consolidado 1404.50 BOB (805.50 + 50.000000 × 11.98) con selection MANUAL, fuente \"Casa de cambio centro\" y sin atribución de provider"
  - "En ningún caso el consolidado desaparece ni se usa 1:1"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-DASHBOARD-007 — Con providers caídos el dinero disponible usa la última tasa conocida marcada obsoleta o una manual más reciente

## Intención

La caída de un tercero no puede borrar ni falsear el número principal del Home: se usa la mejor tasa disponible y se declara su antigüedad u origen (docs/31 D29, RISK-023).

## Escenario

```gherkin
Dado que los providers fallan desde las 14:00Z y la última tasa USDT/BOB es 12.02 de las 13:53:07Z
Cuando consulto el dinero disponible a las 18:00 (La Paz)
Entonces veo 1406.50 BOB
  Y la tasa 12.02 marcada como obsoleta con antigüedad de 8 horas
```

## Notas

- Cubre también el scenario "Tasa manual más reciente que la de provider".
- ageSeconds = 22:00:00 − 13:53:07 = 29 213 s (8 h 6 min).
- Datos ficticios salvo el valor 12.02 (observado en paralelo.bo el 2026-10-02); fechas fijas con `FixedClock` (TZ America/La_Paz).
