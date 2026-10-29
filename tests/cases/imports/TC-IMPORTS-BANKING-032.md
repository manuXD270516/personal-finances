---
id: TC-IMPORTS-BANKING-032
title: "Las solicitudes no llevan datos de PFOS"
spec: imports/banking-providers
related_specs: []
requirement: "Privacidad de las solicitudes al proveedor"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: high
type: security
level: contract
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
  - "Capturar todas las solicitudes al simulado durante una sincronización"
expected_result:
  - "Solo credencial de la conexión, ventana y cursor"
  - "Sin nombres de cuentas, montos, descripciones ni ids de workspace"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-032 — Las solicitudes no llevan datos de PFOS

## Intención

Privacidad (NFR-COMP-001).

## Escenario

```gherkin
Cuando sincronizo
Entonces las solicitudes solo llevan la credencial, la ventana y el cursor
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
