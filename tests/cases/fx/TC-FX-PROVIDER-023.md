---
id: TC-FX-PROVIDER-023
title: "Quitar un par deja de registrarlo y conserva intacto su histórico"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Pares de tasa configurados por workspace"
scenario: "Quitar un par conserva su histórico"
requirement_status: provisional
fr: ["FR-FX-009", "FR-FX-003"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "rate-pairs", "immutability"]
error_code: null
preconditions:
  - "W1 con BTC/USDT configurado y 217 tasas diarias más muestras recientes"
  - "Provider cripto simulado sin red"
input: {"removed": "BTC/USDT"}
steps:
  - "El OWNER quita BTC/USDT"
  - "Ejecutar un ciclo de polling con una muestra BTC/USDT nueva"
  - "Leer las tasas BTC/USDT por id"
expected_result:
  - "El ciclo no registra tasas BTC/USDT en W1"
  - "Las tasas previas conservan valor y vigencia"
  - "Regresión: TC-FX-HISTORICAL-001 y TC-FX-HISTORICAL-002 en verde"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-023 — Quitar un par deja de registrarlo y conserva intacto su histórico

## Intención

D230: quitar un par conserva su histórico; RISK-003: el histórico es inmutable.

## Escenario

```gherkin
Dado BTC/USDT con histórico
Cuando el OWNER lo quita y corre un ciclo
Entonces no se registran tasas nuevas
  Y el histórico no cambia
```

## Notas

