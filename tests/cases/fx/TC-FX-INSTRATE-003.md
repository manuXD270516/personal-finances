---
id: TC-FX-INSTRATE-003
title: "La compra publicada por entidad se registra como BANK_SELL con su código sin inventar el otro lado"
spec: fx/market-rate-providers
related_specs: []
requirement: "Compra y venta por institución como tipos de tasa propios"
scenario: "La fuente publica solo la compra de cada entidad"
requirement_status: provisional
fr: ["FR-FX-002", "FR-FX-009"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011"]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "bank-rates"]
error_code: null
preconditions:
  - "Proveedor simulado (doble en memoria) con vigencia 2026-10-08"
  - "Workspace W1"
input: {"BAD": {"compra": "11.85"}, "BBD": {"compra": "12.03"}}
steps:
  - "Ejecutar un ciclo de ingesta"
  - "Repetir el ciclo con la misma publicación"
expected_result:
  - "Dos tasas USD/BOB BANK_SELL: 11.85 (BAD) y 12.03 (BBD), fuente PROVIDER, vigencia publicada"
  - "Ninguna BANK_BUY ni BANK"
  - "El segundo ciclo no duplica (idempotencia)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-INSTRATE-003 — La compra publicada por entidad se registra como BANK_SELL con su código sin inventar el otro lado

## Intención

D39: la compra de la entidad es lo que el owner recibe al vender USD.

## Escenario

```gherkin
Dado que la fuente publica la compra de BAD a 11.85
Cuando corre la ingesta
Entonces se registra BANK_SELL 11.85 con código BAD
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
