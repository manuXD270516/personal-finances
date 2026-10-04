---
id: TC-FX-PROVIDER-018
title: "El nivel de manuales acepta una tasa manual de otro tipo solo si es reciente y confiable, informando el tipo usado"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates","reporting/dashboard"]
requirement: "Última tasa conocida marcada como obsoleta"
scenario: "Tasa manual fresca de otro tipo"
requirement_status: confirmed
fr: ["FR-FX-010","FR-FX-006","FR-FX-004"]
nfr: []
invariants: ["INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/valuation-rate-selector.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
  - apps/web/src/ui/fx/providers.test.tsx
status: automated
regression_suite: true
phase: 1
tags: ["fx","provider","fallback","manual","staleness","pbt"]
error_code: "FX_RATE_NOT_FOUND"
preconditions:
  - "Preferencia USD/BOB = PARALLEL; FX_STALE_AFTER_PARALLEL = 60m; FX_MANUAL_FALLBACK_MAX_AGE = 24h; FX_ANOMALY_THRESHOLD_PCT = 5; ventana 7 días (docs/31 D34)"
  - "Ambos providers fallan desde las 09:00Z; última tasa de provider: 12.02 de paralelo.bo (asOf 2026-10-02T08:53:07.532Z)"
input: {"amount": "100.00 USD", "t": "2026-10-02T14:00:00Z", "cases": [{"manual": {"type": "P2P", "value": "11.98", "asOf": "2026-10-02T13:30:00Z"}, "expected": "1198.00 BOB"}, {"manual": {"type": "P2P", "value": "11.98", "asOf": "2026-10-01T13:00:00Z"}, "expected": "1202.00 BOB stale"}, {"manual": {"type": "P2P", "value": "12.70", "asOf": "2026-10-02T13:30:00Z"}, "expected": "1202.00 BOB stale"}, {"manual": {"type": "BANK", "value": "12.62", "asOf": "2026-10-02T13:30:00Z"}, "expected": "1262.00 BOB"}]}
steps:
  - "Valorar 100.00 USD en BOB a las 14:00Z en cada caso"
  - "Repetir con la manual P2P reemplazada, anómala pendiente/rechazada/confirmada, con asOf > t y de tipo PARALLEL_BUY"
  - "PBT (fast-check, 500 corridas): candidatos aleatorios de cualquier tipo, origen, vigencia, reemplazo y anomalía; antigüedad máxima aleatoria"
expected_result:
  - "Caso reciente (30 min ≤ 24 h, desvío −0.33 % ≤ 5 %): 1198.00 BOB con la manual 11.98, selection MANUAL, rateType P2P, requestedRateType PARALLEL, stale false"
  - "Caso no vigente (25 h > 24 h): 1202.00 BOB con 12.02 de paralelo.bo, LAST_KNOWN_STALE; sin tasa de provider ⇒ FX_RATE_NOT_FOUND; con FX_MANUAL_FALLBACK_MAX_AGE = 26h vuelve a valer"
  - "Desvío: P2P 12.70 (+5.66 % > 5 %) se descarta; BANK 12.62 (+4.99 %) se usa; la referencia vale también para una manual en orientación inversa (BOB/USD); sin tasa de provider solo rige la antigüedad"
  - "Nunca se usa una manual de otro tipo reemplazada, con anomalía pendiente o rechazada (confirmada sí), con asOf > t ni de compra/venta"
  - "Los niveles de provider (principal, respaldo) van antes; la manual del tipo pedido no exige frescura (comportamiento de fx/market-rates); entre manuales gana la más reciente"
  - "Si el tipo pedido no tiene umbral (P2P, BANK, CUSTOM) no hay sustitución; la referencia de una conversión no cambia"
  - "PBT: si rateType ≠ requestedRateType entonces la tasa es manual, selection MANUAL, no es de compra/venta, 0 ≤ t − asOf ≤ antigüedad máxima, desvío ≤ 5 % respecto de la última tasa de provider usable del tipo pedido, no reemplazada y sin anomalía sin confirmar"
created: 2026-10-03
updated: 2026-10-04
---

# TC-FX-PROVIDER-018 — El nivel de manuales acepta una tasa manual de otro tipo solo si es reciente y confiable, informando el tipo usado

## Intención

Decisión del owner (2026-10-03; docs/31 D34; pregunta abierta de add-basic-dashboard, variante de TC-REPORTING-DASHBOARD-007): si no hay providers vigentes, una tasa manual reciente de otro tipo (p. ej. `P2P`) es mejor que una paralela vieja, pero solo si es reciente (≤ 24 h), confiable (no reemplazada, sin anomalía sin confirmar) y coherente con el mercado (desvío ≤ 5 % respecto de la última tasa de provider), y el resultado debe decir qué tipo se usó. Los casos de reporting equivalentes son TC-REPORTING-DASHBOARD-008/-009 (rama de specs).

## Escenario

```gherkin
Dado la preferencia de USD/BOB es PARALLEL y ambos providers fallan desde las 09:00Z
  Y el usuario registra la tasa manual USD/BOB P2P 11.98 con vigencia 13:30Z
Cuando valoro 100.00 USD a las 14:00Z
Entonces obtengo 1198.00 BOB con la tasa manual 11.98, tipo usado P2P y tipo pedido PARALLEL
```

## Notas

- `ResolvedRate.requestedRateType` (aditivo en el contrato) junto a `rateType` marca la sustitución; `RateSourceBadge` ya muestra el tipo usado.
- Solo aplica si el tipo pedido lo alimentan providers (`PARALLEL`, `OFFICIAL` y su compra/venta); para `P2P`/`BANK`/`CUSTOM` no hay sustitución. Desvío calculado en Decimal: `|m − p| / p × 100` en la orientación de la manual.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI.
