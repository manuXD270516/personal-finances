---
id: TC-IMPORTS-BANKING-011
title: "Una clave con permisos de retiro se rechaza y se destruye"
spec: imports/banking-providers
related_specs: []
requirement: "Solo credenciales de solo lectura"
scenario: "Clave con permiso de retiro"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-008"]
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
error_code: "CONNECTION_CREDENTIAL_NOT_READ_ONLY"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
input: {"permissions":{"read":true,"trade":false,"withdraw":true,"transfer":false}}
steps:
  - "Crear la conexión"
  - "Ejecutar el job de verificación"
  - "GET de la conexión"
expected_result:
  - "Estado REJECTED con lastError.code CONNECTION_CREDENTIAL_NOT_READ_ONLY"
  - "wrapped_dek y ciphertext nulos"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-011 — Una clave con permisos de retiro se rechaza y se destruye

## Intención

Solo lectura verificada (docs/13 §6.2).

## Escenario

```gherkin
Dada una clave con retiros habilitados
Cuando creo la conexión
Entonces queda rechazada y su credencial destruida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
