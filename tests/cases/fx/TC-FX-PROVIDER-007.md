---
id: TC-FX-PROVIDER-007
title: "La valoración usa el principal y conmuta al respaldo cuando el principal falla o queda obsoleto"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Selección de la tasa de valoración con fallback entre providers"
scenario: "Principal caído"
requirement_status: confirmed
fr: ["FR-FX-010","FR-FX-006"]
nfr: []
invariants: ["INV-020","INV-012"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/valuation-rate-selector.test.ts
  - apps/api/test/api/fx-providers.api.test.ts
  - tests/e2e/specs/fx-providers.spec.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","provider","fallback","staleness","valuation"]
error_code: null
preconditions:
  - "Preferencia USD/BOB = PARALLEL; FX_STALE_AFTER_PARALLEL = 60m; ventana 7 días"
  - "Tasas: paralelo.bo 12.02 (asOf 2026-10-02T08:53:07.532Z); bo.dolarapi.com 12.055 (asOf 2026-10-02T09:50:00Z)"
input: {"amount": "100.00 USD", "cases": [{"t": "2026-10-02T09:00:00Z", "expected": "1202.00 BOB", "selection": "PRIMARY"}, {"t": "2026-10-02T10:00:00Z", "primary_failing_since": "09:15Z", "expected": "1205.50 BOB", "selection": "FALLBACK"}, {"t": "2026-10-02T09:00:00Z", "primary_last_asOf": "2026-10-02T07:40:00Z", "dolarapi_asOf": "2026-10-02T08:50:00Z", "expected": "1205.50 BOB", "selection": "FALLBACK"}]}
steps:
  - "Valorar 100.00 USD en BOB en cada caso con ValuationRateSelector"
expected_result:
  - "Caso 1: 1202.00 BOB con 12.02 de paralelo.bo, selection PRIMARY, ageSeconds 412, stale false"
  - "Caso 2: la tasa de paralelo.bo tiene 66 min (> 60) y es obsoleta; resultado 1205.50 BOB con 12.055 de bo.dolarapi.com, selection FALLBACK, ageSeconds 600"
  - "Caso 3 (principal responde pero repite timestamp 07:40Z, 80 min): resultado 1205.50 BOB con selection FALLBACK"
  - "Nunca se usa una tasa con asOf posterior al instante consultado"
created: 2026-10-02
updated: 2026-10-04
---

# TC-FX-PROVIDER-007 — La valoración usa el principal y conmuta al respaldo cuando el principal falla o queda obsoleto

## Intención

La conmutación entre fuentes debe ser determinista y explicable, no una caja negra.

## Escenario

```gherkin
Dado paralelo.bo falla desde las 09:15Z y su última tasa es de las 08:53Z
  Y bo.dolarapi.com dio 12.055 a las 09:50Z
Cuando valoro 100.00 USD a las 10:00Z
Entonces obtengo 1205.50 BOB con la tasa de respaldo
```

## Notas

- Test de dominio puro (TDD) con `FixedClock`; los cálculos: 100.00 × 12.02 = 1202.00; 100.00 × 12.055 = 1205.50.
- ageSeconds del caso 1 = 09:00:00 − 08:53:07.532 = 412.468 s, truncado a 412.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
