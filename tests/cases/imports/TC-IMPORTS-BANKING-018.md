---
id: TC-IMPORTS-BANKING-018
title: "Cancelar la vista previa no mueve el cursor confirmado"
spec: imports/banking-providers
related_specs: []
requirement: "Sincronización incremental con ventana y cursor"
scenario: "Import cancelado no avanza el cursor"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
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
input: {}
steps:
  - "Sincronizar"
  - "Cancelar la vista previa"
  - "Sincronizar de nuevo"
expected_result:
  - "sync_cursor sin cambio"
  - "La nueva sincronización trae los mismos registros"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-018 — Cancelar la vista previa no mueve el cursor confirmado

## Intención

El cursor solo avanza al completar.

## Escenario

```gherkin
Dada una sincronización en vista previa
Cuando la cancelo
Entonces el cursor queda donde estaba
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
