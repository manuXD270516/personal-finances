---
id: TC-IMPORTS-BANKING-015
title: "La rotación vuelve a envolver las claves de datos sin descifrar secretos"
spec: imports/banking-providers
related_specs: []
requirement: "Rotación de la clave maestra"
scenario: "Rotar de k1 a k2"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-SEC-007"]
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
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
  - "3 conexiones con credenciales envueltas con k1"
input: {"keys":"k2 vigente, k1 retirable"}
steps:
  - "Configurar k2 como vigente"
  - "Ejecutar imports.credentials-rewrap"
  - "Quitar k1 y sincronizar"
expected_result:
  - "Las 3 con kid = k2"
  - "El secreto no se descifra durante la rotación (espía sobre el descifrado de datos)"
  - "Las sincronizaciones funcionan sin k1"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-015 — La rotación vuelve a envolver las claves de datos sin descifrar secretos

## Intención

Key ring con kid.

## Escenario

```gherkin
Dadas 3 credenciales con k1
Cuando roto a k2
Entonces quedan envueltas con k2
  Y k1 puede retirarse
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
