---
id: TC-IMPORTS-BANKING-031
title: "Una redirección fuera de la allowlist se bloquea sin enviar la credencial"
spec: imports/banking-providers
related_specs: []
requirement: "Privacidad de las solicitudes al proveedor"
scenario: "Host no permitido"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-001", "NFR-SEC-015"]
invariants: []
priority: critical
type: security
level: security
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
input: {"redirect":"https://evil.example.test"}
steps:
  - "El simulado responde 302 hacia un host no permitido"
expected_result:
  - "La solicitud se bloquea"
  - "El host no permitido no recibe ninguna solicitud"
  - "La sincronización falla"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-031 — Una redirección fuera de la allowlist se bloquea sin enviar la credencial

## Intención

ProviderHttpClient con allowlist por descriptor.

## Escenario

```gherkin
Dada una redirección a un host no permitido
Cuando sincronizo
Entonces la solicitud se bloquea sin enviar la credencial
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
