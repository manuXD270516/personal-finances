---
id: TC-FX-PROVIDER-008
title: "Sin providers vigentes se usa la última tasa conocida marcada obsoleta o una manual más reciente"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Última tasa conocida marcada como obsoleta"
scenario: "Ambos providers caídos"
requirement_status: confirmed
fr: ["FR-FX-010","FR-FX-004"]
nfr: []
invariants: ["INV-020"]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["fx","provider","staleness","fallback","missing-rate"]
error_code: "FX_RATE_NOT_FOUND"
preconditions:
  - "Preferencia USD/BOB = PARALLEL; FX_STALE_AFTER_PARALLEL = 60m; ventana 7 días"
  - "Ambos providers fallan desde 2026-10-02T09:00:00Z; última tasa de provider: 12.02 de paralelo.bo (asOf 08:53:07.532Z)"
input: {"amount": "100.00 USD", "cases": [{"t": "2026-10-02T14:53:07.532Z"}, {"t": "2026-10-02T14:00:00Z", "manual": {"pair": "USD/BOB", "type": "PARALLEL", "value": "12.10", "asOf": "2026-10-02T13:00:00Z"}}, {"t": "2026-10-02T12:00:00Z", "last_rate_any_origin": "2026-09-20"}]}
steps:
  - "Valorar 100.00 USD en cada caso"
expected_result:
  - "Caso 1: 1202.00 BOB con 12.02 de paralelo.bo, selection LAST_KNOWN_STALE, stale true, ageSeconds 21600 (6 h)"
  - "Caso 2: 1210.00 BOB con la tasa manual 12.10, selection MANUAL, source MANUAL, sin atribución de provider"
  - "Caso 3: FX_RATE_NOT_FOUND; ningún valor aproximado ni 1:1"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-008 — Sin providers vigentes se usa la última tasa conocida marcada obsoleta o una manual más reciente

## Intención

Ante una caída total el número sigue siendo honesto: dice cuán vieja es la tasa o que no hay tasa.

## Escenario

```gherkin
Dado que ambos providers fallan y la última tasa es 12.02 de las 08:53:07Z
Cuando valoro 100.00 USD a las 14:53:07Z
Entonces obtengo 1202.00 BOB marcado como obsoleto con 6 horas de antigüedad
```

## Notas

- Test de dominio puro (TDD). Caso 2 cubre el scenario "Tasa manual más reciente que la de provider"; caso 3 "Sin tasa dentro de la ventana".
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
