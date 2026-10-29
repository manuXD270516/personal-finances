---
id: TC-IMPORTS-BANKING-021
title: "Archivo y API del mismo exchange comparten la referencia externa"
spec: imports/banking-providers
related_specs: []
requirement: "Idempotencia por identificador del proveedor"
scenario: "Mismo historial por archivo y por API"
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: critical
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
  - "Trade T-1001 importado por la API simulada"
  - "Conexión de archivo simulada del mismo exchange"
input: {"file":"historial sintético con T-1001"}
steps:
  - "Subir el archivo"
expected_result:
  - "T-1001 aparece como ya importado"
  - "Ninguna conversión nueva"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-021 — Archivo y API del mismo exchange comparten la referencia externa

## Intención

Namespace imports.provider:<exchange>:<tipo> compartido.

## Escenario

```gherkin
Dado un trade importado por API
Cuando subo el archivo que lo contiene
Entonces aparece como ya importado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
