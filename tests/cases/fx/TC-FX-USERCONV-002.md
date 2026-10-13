---
id: TC-FX-USERCONV-002
title: "Las observaciones de conversiones nunca cambian una valoración ni la referencia de otra conversión"
spec: fx/market-rates
related_specs: []
requirement: "Las observaciones de conversiones nunca se usan para valorar"
scenario: "Observación más reciente que la tasa del provider"
requirement_status: provisional
fr: ["FR-FX-006", "FR-FX-008"]
nfr: []
invariants: []
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "user-conversion", "valuation", "pbt"]
error_code: null
preconditions:
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo con vigencia 13:50Z; observación 11.90 de las 14:00Z"
input: {"amount": "100.000000 USDT", "at": "2026-10-05T14:05:00Z"}
steps:
  - "Valorar 100.000000 USDT"
  - "Registrar una conversión a las 14:10Z sin referencia"
  - "PBT: agregar observaciones aleatorias (más recientes, de cualquier par) y revalorar, con timeout explícito"
expected_result:
  - "1202.00 BOB con 12.02 de paralelo.bo"
  - "La conversión de las 14:10Z no toma 11.90 como referencia"
  - "PBT: ninguna valoración, referencia ni tasa cruzada cambia por agregar observaciones"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-USERCONV-002 — Las observaciones de conversiones nunca cambian una valoración ni la referencia de otra conversión

## Intención

D231 y D29: las observaciones son historial, nunca valoración.

## Escenario

```gherkin
Dado una observación más reciente que la tasa del provider
Cuando se valora
Entonces se usa la tasa del provider
```

## Notas

- Regresión: TC-FX-PROVIDER-001..019 y TC-REPORTING-NETWORTH-*.
