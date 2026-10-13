---
id: TC-FX-PROVIDER-024
title: "El ciclo de providers registra en cada workspace solo los pares de su lista"
spec: fx/market-rate-providers
related_specs: []
requirement: "Registro automático solo para los pares configurados"
scenario: "Workspace sin USD/BOB"
requirement_status: provisional
fr: ["FR-FX-009"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "rate-pairs", "ingestion"]
error_code: null
preconditions:
  - "W1 configura USDT/BOB y BTC/USDT; W2 usa la lista por defecto con USD y USDT"
  - "paralelo.bo simulado con mediana 12.02"
input: {"median": "12.02"}
steps:
  - "Ejecutar un ciclo de polling"
expected_result:
  - "W1 registra USDT/BOB PARALLEL 12.02 y ninguna tasa USD/BOB"
  - "W2 registra USD/BOB y USDT/BOB como antes de este change"
  - "Se envía una sola solicitud a paralelo.bo para ambos workspaces"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-024 — El ciclo de providers registra en cada workspace solo los pares de su lista

## Intención

Generaliza la lista fija de Phase 1 sin cambiar el comportamiento de los workspaces con la lista por defecto.

## Escenario

```gherkin
Dado W1 sin USD/BOB en su lista
Cuando corre un ciclo con la mediana 12.02
Entonces W1 solo registra USDT/BOB
```

## Notas

