---
id: TC-IMPORTS-BANKING-033
title: "Solo el OWNER gestiona credenciales y revoca"
spec: imports/banking-providers
related_specs: []
requirement: "Permisos y auditoría de las conexiones"
scenario: "EDITOR intenta revocar"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuarios EDITOR y VIEWER"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC"
input: {}
steps:
  - "EDITOR: revoke, PUT credential, POST connections"
  - "EDITOR: sync"
  - "VIEWER: GET connections, sync"
expected_result:
  - "EDITOR: 403 en revocar, credencial y crear; 202 en sync"
  - "VIEWER: 200 en GET; 403 en sync"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-033 — Solo el OWNER gestiona credenciales y revoca

## Intención

Matriz de roles de conexiones.

## Escenario

```gherkin
Dado un EDITOR
Cuando intenta revocar Exchange principal
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
