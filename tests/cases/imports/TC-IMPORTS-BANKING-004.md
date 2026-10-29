---
id: TC-IMPORTS-BANKING-004
title: "Crear una conexión con dos mapeos de activo a cuenta"
spec: imports/banking-providers
related_specs: []
requirement: "Conexión con un proveedor y mapeo de activos a cuentas"
scenario: "Mapear USDT y BTC"
requirement_status: provisional
fr: ["FR-IMPORTS-013", "FR-IMPORTS-014"]
nfr: []
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
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
input: {"name":"Exchange principal","assetMappings":[{"asset":"USDT","account":"Exchange USDT"},{"asset":"BTC","account":"Exchange BTC"}]}
steps:
  - "POST W/imports/connections con credencial e Idempotency-Key"
  - "Ejecutar el job de verificación"
expected_result:
  - "202 PENDING_VERIFICATION y luego ACTIVE"
  - "Dos mapeos guardados"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-004 — Crear una conexión con dos mapeos de activo a cuenta

## Intención

Conexión con mapeo por activo.

## Escenario

```gherkin
Cuando creo Exchange principal con USDT y BTC mapeados
Entonces la conexión queda creada con esos mapeos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
