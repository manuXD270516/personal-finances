---
id: TC-IMPORTS-BANKING-002
title: "Un proveedor con términos pendientes no admite conexiones"
spec: imports/banking-providers
related_specs: []
requirement: "Proveedores habilitados solo con términos y formato verificados"
scenario: "Exchange con términos pendientes"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: "BANKING_PROVIDER_NOT_AVAILABLE"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
input: {"providerId":"EXCHANGE_API_BINANCE"}
steps:
  - "GET W/imports/providers"
  - "POST W/imports/connections con EXCHANGE_API_BINANCE"
expected_result:
  - "availability PENDING_VERIFICATION"
  - "422 BANKING_PROVIDER_NOT_AVAILABLE"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-002 — Un proveedor con términos pendientes no admite conexiones

## Intención

NFR-COMP-007; ADR-0029 C4 sigue vigente hasta ADR-0030.

## Escenario

```gherkin
Dado Binance con términos pendientes
Cuando intento crear una conexión
Entonces se rechaza con BANKING_PROVIDER_NOT_AVAILABLE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
