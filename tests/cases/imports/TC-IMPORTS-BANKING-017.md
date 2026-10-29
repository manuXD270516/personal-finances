---
id: TC-IMPORTS-BANKING-017
title: "La segunda sincronización continúa desde el cursor confirmado"
spec: imports/banking-providers
related_specs: []
requirement: "Sincronización incremental con ventana y cursor"
scenario: "Primera y segunda sincronización"
requirement_status: provisional
fr: ["FR-IMPORTS-013", "FR-IMPORTS-009"]
nfr: []
invariants: []
priority: medium
type: integration
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC"
input: {"first":{"from":"2026-07-01","approvedAt":"2026-10-20"},"second":"2026-10-27"}
steps:
  - "Primera sincronización con from y aprobación"
  - "Segunda sincronización"
expected_result:
  - "La segunda pide solo desde el cursor confirmado el 2026-10-20"
  - "Ambas pasan por vista previa"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-017 — La segunda sincronización continúa desde el cursor confirmado

## Intención

Sincronización incremental (FR-IMPORTS-013).

## Escenario

```gherkin
Dada una primera sincronización aprobada el 2026-10-20
Cuando sincronizo el 2026-10-27
Entonces solo se piden registros posteriores al cursor
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
