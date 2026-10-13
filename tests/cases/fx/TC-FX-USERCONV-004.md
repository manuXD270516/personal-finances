---
id: TC-FX-USERCONV-004
title: "El historial de tasas muestra las observaciones con su origen y permite filtrarlas"
spec: fx/market-rates
related_specs: []
requirement: "Las observaciones de conversiones nunca se usan para valorar"
scenario: null
requirement_status: confirmed
fr: ["FR-FX-011", "FR-FX-002"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/conversion-costs.api.test.ts
  - packages/contexts/fx/src/interface/fx-http.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "user-conversion", "history"]
error_code: null
preconditions:
  - "USDT/BOB con tasas de provider, una manual y dos observaciones (una anulada)"
input: {"source": "USER_CONVERSION"}
steps:
  - "GET W/fx-rates?base=USDT&quote=BOB"
  - "GET W/fx-rates?source=USER_CONVERSION"
expected_result:
  - "Las observaciones aparecen con source USER_CONVERSION, conversionRef y, la anulada, withdrawn"
  - "El filtro devuelve solo las dos observaciones"
  - "fx.RateRecorded.v1 de cada observación valida contra su schema"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-USERCONV-004 — El historial de tasas muestra las observaciones con su origen y permite filtrarlas

## Intención

D231: visibles en el historial.

## Escenario

```gherkin
Dado dos observaciones de USDT/BOB
Cuando se filtra por origen
Entonces se ven solo esas dos con su conversión
```

## Notas

