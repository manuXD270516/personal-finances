---
id: TC-IMPORTS-BANKING-010
title: "Un descriptor con usuario y contraseña no se registra"
spec: imports/banking-providers
related_specs: []
requirement: "Nunca usuario y contraseña de banca"
scenario: "Descriptor que pide contraseña"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-008"]
invariants: []
priority: critical
type: unit
level: unit
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
input: {"credentialMode":"USERNAME_PASSWORD"}
steps:
  - "Registrar el descriptor en el arranque"
expected_result:
  - "El registro falla"
  - "El proveedor no aparece en el catálogo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-010 — Un descriptor con usuario y contraseña no se registra

## Intención

NFR-COMP-008.

## Escenario

```gherkin
Dado un descriptor que pide usuario y contraseña
Cuando se registra
Entonces falla y no aparece en el catálogo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
