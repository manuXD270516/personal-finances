---
id: TC-IMPORTS-BANKING-013
title: "Revocar destruye la credencial y conserva lo importado"
spec: imports/banking-providers
related_specs: []
requirement: "Revocación de una conexión"
scenario: "Revocar la conexión del exchange"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-008"]
invariants: ["INV-029"]
priority: critical
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
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC con 37 transacciones importadas"
input: {}
steps:
  - "POST W/imports/connections/{id}/revoke con If-Match"
  - "POST …/sync"
  - "Intentar descifrar en el worker"
expected_result:
  - "Estado REVOKED; auditoría"
  - "sync ⇒ 409 INVALID_STATUS_TRANSITION"
  - "Descifrado imposible; las 37 transacciones siguen"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-013 — Revocar destruye la credencial y conserva lo importado

## Intención

Destrucción criptográfica.

## Escenario

```gherkin
Dada la conexión con 37 transacciones
Cuando la revoco
Entonces su credencial no se puede descifrar
  Y las 37 transacciones siguen
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
