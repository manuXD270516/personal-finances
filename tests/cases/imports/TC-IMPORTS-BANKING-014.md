---
id: TC-IMPORTS-BANKING-014
title: "Una clave rechazada deja la conexión en requiere atención"
spec: imports/banking-providers
related_specs: []
requirement: "Credencial rechazada por el proveedor"
scenario: "Clave borrada en el exchange"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: "IMPORT_CONNECTION_EXPIRED"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC"
input: {"providerResponse":401}
steps:
  - "Sincronizar con el simulado devolviendo 401"
  - "PUT …/credential con una clave de solo lectura"
expected_result:
  - "Import FAILED con IMPORT_CONNECTION_EXPIRED; conexión NEEDS_ATTENTION"
  - "Tras reemplazar y verificar: ACTIVE"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-014 — Una clave rechazada deja la conexión en requiere atención

## Intención

Reemplazo de credencial.

## Escenario

```gherkin
Dada una clave borrada en el exchange
Cuando sincronizo
Entonces falla con IMPORT_CONNECTION_EXPIRED
  Y al reemplazarla vuelve a activa
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
