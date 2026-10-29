---
id: TC-IMPORTS-BANKING-012
title: "Permisos ampliados detienen la sincronización"
spec: imports/banking-providers
related_specs: []
requirement: "Solo credenciales de solo lectura"
scenario: "Permisos ampliados después"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: []
invariants: []
priority: critical
type: integration
level: application
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
input: {"permissions":{"read":true,"trade":true}}
steps:
  - "El simulado informa trade = true"
  - "Sincronizar"
expected_result:
  - "Conexión NEEDS_ATTENTION"
  - "fetchRecords no se llama"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-012 — Permisos ampliados detienen la sincronización

## Intención

Re-verificación en cada sincronización.

## Escenario

```gherkin
Dada una conexión activa
Cuando su clave pasa a permitir operar
Entonces la sincronización no lee movimientos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
