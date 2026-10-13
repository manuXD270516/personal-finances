---
id: TC-FX-PROVIDER-037
title: "El estado de providers informa por cada par configurado su cobertura y la antigüedad de su última tasa automática"
spec: fx/market-rate-providers
related_specs: []
requirement: "Estado de los providers consultable"
scenario: "Pares configurados en el estado"
requirement_status: confirmed
fr: ["FR-FX-016"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
  - packages/contexts/fx/src/interface/fx-http.test.ts
  - apps/api/test/api/fx-rate-pairs.api.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "status", "rate-pairs"]
error_code: null
preconditions:
  - "W1 configura USDT/BOB, BTC/USDT y EUR/BOB; FixedClock 2026-10-13T14:05:00Z"
input: {}
steps:
  - "GET W/fx-providers/status"
expected_result:
  - "pairs incluye USDT/BOB cubierto por paralelo.bo y bo.dolarapi.com"
  - "BTC/USDT cubierto por los providers cripto con lastAutomaticRateAt y ageSeconds"
  - "EUR/BOB con coverage MANUAL_ONLY"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-037 — El estado de providers informa por cada par configurado su cobertura y la antigüedad de su última tasa automática

## Intención

El criterio de 30 días se verifica sobre esta vista (D220).

## Escenario

```gherkin
Dado tres pares configurados
Cuando se consulta el estado
Entonces cada par informa su cobertura
```

## Notas

