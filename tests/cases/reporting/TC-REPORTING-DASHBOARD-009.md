---
id: TC-REPORTING-DASHBOARD-009
title: "Una tasa manual de otro tipo solo entra al último recurso si es fresca y confiable"
spec: reporting/dashboard
related_specs: ["fx/market-rate-providers","fx/market-rates"]
requirement: "Valoración de USD y USDT con fallback a la última tasa conocida o manual"
scenario: "Tasa manual de otro tipo no fresca descartada"
requirement_status: confirmed
fr: ["FR-REPORTING-003","FR-FX-010","FR-FX-006"]
nfr: []
invariants: ["INV-020"]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["dashboard","liquid-balance","fx","fallback","manual-rate"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz; FixedClock en 2026-09-30T18:00:00-04:00 (22:00:00Z)"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (ASSET, LIQUID)"
  - "Preferencia USDT/BOB = PARALLEL; FX_STALE_AFTER_PARALLEL = 60m; ventana 7 días; FX_MANUAL_FALLBACK_MAX_AGE = 24h; umbral de anomalía 5 %"
input: {"caseA":{"providerRate":{"value":"12.02","asOf":"2026-09-29T13:53:07Z"},"manualRate":{"type":"P2P","value":"11.98","asOf":"2026-09-29T15:00:00Z"}},"caseB":{"providerRate":{"value":"12.02","asOf":"2026-09-30T13:53:07Z"},"manualRate":{"type":"P2P","value":"11.00","asOf":"2026-09-30T20:00:00Z"}}}
steps:
  - "Caso A: providers caídos desde 2026-09-29T14:00:00Z; consultar el resumen"
  - "Caso B: providers caídos desde 2026-09-30T14:00:00Z; consultar el resumen"
expected_result:
  - "Caso A: la manual P2P tiene 31 h (> 24 h) y se descarta aunque sea más reciente; consolidado 1406.50 BOB con 12.02 PARALELO_BO, selection LAST_KNOWN_STALE, stale true"
  - "Caso B: la manual P2P 11.00 se desvía 8.49 % (> 5 %) de 12.02 y se descarta; consolidado 1406.50 BOB con 12.02 PARALELO_BO, selection LAST_KNOWN_STALE"
  - "Contraste (TC-REPORTING-DASHBOARD-007, variante): la manual P2P 11.98 de 2 h y desvío 0.33 % sí se usa (1404.50 BOB, selection MANUAL, rateType P2P)"
created: 2026-10-03
updated: 2026-10-04
---

# TC-REPORTING-DASHBOARD-009 — Una tasa manual de otro tipo solo entra al último recurso si es fresca y confiable

## Intención

Decisión del owner D34 (docs/31, 2026-10-03): el último recurso admite manuales de cualquier tipo del par, pero una manual vieja o anómala no puede desplazar a la última tasa conocida del provider.

## Escenario

```gherkin
Dado que los providers fallan y la última tasa USDT/BOB del provider es 12.02 (obsoleta)
  Y existe una tasa manual P2P más reciente pero con 31 horas de antigüedad
Cuando consulto el dinero disponible
Entonces veo 1406.50 BOB valorado con 12.02 marcada como obsoleta
  Y la tasa manual P2P no se usa
```

## Notas

- Cubre también el scenario "Tasa manual de otro tipo con desvío excesivo descartada" (caso B).
- Desvío = |11.00 − 12.02| / 12.02 = 8.4859… % → 8.49 % (HALF_EVEN, 2 decimales) > 5 %.
- El máximo de frescura de 24 h lo confirmó el owner (docs/31 D38; `FX_MANUAL_FALLBACK_MAX_AGE`).
- Automatizado (2026-10-04) en `apps/api/test/api/reports.api.test.ts` con la ingesta real y la tasa grabada de paralelo.bo (12.02 de 2026-10-02T08:53:07.532Z): las fechas se desplazan al mismo esquema relativo (ahora 2026-10-03T17:00Z; caso A manual P2P 11.98 de 31 h; caso B manual P2P 11.00 de 1 h con 8.49 %; contraste P2P 11.98 de 30 min ⇒ MANUAL 1404.50 BOB).
- La selección vive en FX (`ValuationRateSelector`, `fx/market-rate-providers`); este TC la verifica desde el resumen.
