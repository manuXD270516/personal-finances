---
id: TC-FX-PROVIDER-035
title: "Un monto valorado con tasa cruzada muestra la atribución de cada componente de provider"
spec: fx/market-rate-providers
related_specs: ["reporting/net-worth"]
requirement: "Atribución visible de la fuente de la tasa"
scenario: "Bitcoin valorado con una tasa cruzada"
requirement_status: provisional
fr: ["FR-FX-014"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "attribution", "cross-rate"]
error_code: null
preconditions:
  - "BTC/USDT MARKET del provider cripto principal y USDT/BOB PARALLEL de paralelo.bo"
  - "\"Wallet BTC\" con 0.01500000 BTC"
input: {}
steps:
  - "GET W/reports/summary y GET W/fx-rates/latest para BTC/BOB"
expected_result:
  - "meta.attributions incluye la atribución registrada del provider cripto y \"Fuente: paralelo.bo\" con CC BY 4.0, sin duplicados"
  - "La tasa resuelta lista ambas componentes con su atribución"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-035 — Un monto valorado con tasa cruzada muestra la atribución de cada componente de provider

## Intención

FR-FX-014: la atribución acompaña a toda tasa de provider, también dentro de una cruzada.

## Escenario

```gherkin
Dado BTC valorado en BOB por cruzada
Cuando se consulta el resumen
Entonces se ven ambas atribuciones
```

## Notas

