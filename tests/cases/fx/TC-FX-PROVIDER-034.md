---
id: TC-FX-PROVIDER-034
title: "Las solicitudes al provider cripto no dependen de los pares ni de las fechas de ningún workspace"
spec: fx/market-rate-providers
related_specs: []
requirement: "Las consultas a providers no envían datos del usuario"
scenario: "Solicitudes cripto independientes de los pares configurados"
requirement_status: provisional
fr: ["FR-FX-015"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: critical
type: security
level: contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "crypto", "privacy"]
error_code: null
preconditions:
  - "Servidor HTTP local que registra cada solicitud byte a byte"
  - "Catálogo global con BTC y ETH"
input: {"W1": ["BTC/USDT"], "W2": ["ETH/USDT"]}
steps:
  - "Ejecutar un ciclo y el backfill con W1 y W2 configurados"
  - "Repetir con ningún workspace con pares cripto"
  - "Comparar las solicitudes"
expected_result:
  - "Las solicitudes son idénticas en ambas corridas (símbolos y rangos)"
  - "Ninguna lleva cookies, credenciales, identificadores, montos ni fechas de movimientos"
  - "Los rangos del histórico son los de FX_CRYPTO_HISTORY_FROM, no las primeras fechas con saldo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-034 — Las solicitudes al provider cripto no dependen de los pares ni de las fechas de ningún workspace

## Intención

FR-FX-015 incluye monedas habilitadas y, por extensión, pares configurados y fechas de movimientos: consultar solo lo que tiene cada workspace revelaría sus tenencias.

## Escenario

```gherkin
Dado W1 con BTC y W2 con ETH
Cuando corre el ciclo
Entonces las solicitudes son las mismas que sin pares cripto
```

## Notas

