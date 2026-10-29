---
id: TC-IMPORTS-BANKING-008
title: "Solo el worker puede descifrar las credenciales"
spec: imports/banking-providers
related_specs: []
requirement: "Credenciales cifradas y nunca expuestas"
scenario: "El proceso de la API no puede descifrar"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-SEC-007", "NFR-SEC-016"]
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
input: {}
steps:
  - "Intentar descifrar con la configuración de la API (solo claves públicas)"
  - "Como pf_app, SELECT de wrapped_dek y ciphertext"
  - "Descifrar en el worker"
expected_result:
  - "La API no tiene clave privada y falla"
  - "pf_app recibe permission denied en esas columnas"
  - "El worker obtiene el secreto"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-008 — Solo el worker puede descifrar las credenciales

## Intención

Sobre asimétrico y grants por columna (design decisión 3).

## Escenario

```gherkin
Dada una credencial guardada
Cuando la API intenta descifrarla
Entonces no puede
  Y el worker sí
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
