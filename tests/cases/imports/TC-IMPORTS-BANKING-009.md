---
id: TC-IMPORTS-BANKING-009
title: "El secreto no aparece en logs, errores, auditoría, idempotencia ni export"
spec: imports/banking-providers
related_specs: []
requirement: "Credenciales cifradas y nunca expuestas"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-SEC-015", "NFR-SEC-007"]
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
input: {"secret":"valor de prueba único"}
steps:
  - "Corrida completa: crear, verificar con error forzado, sincronizar, revocar, exportar"
  - "Buscar el valor en logs, cuerpos de respuesta y error, audit_log, idempotency_key y el archivo del export"
expected_result:
  - "0 apariciones del secreto"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-009 — El secreto no aparece en logs, errores, auditoría, idempotencia ni export

## Intención

Escaneo de secretos de la tarea 8.3.

## Escenario

```gherkin
Dado un secreto de prueba único
Cuando recorro todo el ciclo de la conexión
Entonces el secreto no aparece en ninguna salida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
