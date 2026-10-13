---
id: TC-FX-PROVIDER-027
title: "El adapter cripto de respaldo es independiente del principal y produce tasas MARKET con su propio provider"
spec: fx/market-rate-providers
related_specs: []
requirement: "Precios de mercado de criptomonedas desde providers de exchange"
scenario: null
requirement_status: provisional
fr: ["FR-FX-009", "FR-FX-010"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: integration
level: contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "crypto", "adapter", "fallback", "no-network"]
error_code: null
preconditions:
  - "Verificación de términos del respaldo registrada como apta en ADR-0029"
  - "Respuesta grabada del respaldo servida localmente"
input: {"pair": "BTC/USDT"}
steps:
  - "Ejecutar fetchLatest del adapter de respaldo"
  - "Simular falla del principal y ejecutar un ciclo"
expected_result:
  - "Muestras MARKET con el id del provider de respaldo"
  - "El respaldo es de otro operador que el principal (descriptor)"
  - "La falla del principal no impide registrar las muestras del respaldo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-027 — El adapter cripto de respaldo es independiente del principal y produce tasas MARKET con su propio provider

## Intención

D225 exige un respaldo independiente para que las fallas no estén correlacionadas.

## Escenario

```gherkin
Dado el principal caído
Cuando corre un ciclo
Entonces se registran las tasas MARKET del respaldo
```

## Notas

