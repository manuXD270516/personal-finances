---
id: TC-IMPORTS-BANKING-005
title: "Un activo sin mapear llega como fila no importable"
spec: imports/banking-providers
related_specs: []
requirement: "Conexión con un proveedor y mapeo de activos a cuentas"
scenario: "Activo sin cuenta"
requirement_status: provisional
fr: ["FR-IMPORTS-014"]
nfr: []
invariants: []
priority: high
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
input: {"record":"DEPOSIT 12.500000 TRX"}
steps:
  - "Sincronizar"
  - "Ver la vista previa"
  - "Aprobar"
expected_result:
  - "Fila con issue CONNECTION_ASSET_UNMAPPED"
  - "Ninguna transacción creada para ella"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-005 — Un activo sin mapear llega como fila no importable

## Intención

Nunca crear en otra cuenta.

## Escenario

```gherkin
Dado un depósito de 12.500000 TRX sin mapeo
Cuando sincronizo
Entonces la fila no es importable
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
