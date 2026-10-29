---
id: TC-IMPORTS-BANKING-007
title: "La credencial se guarda cifrada y solo se muestra su huella"
spec: imports/banking-providers
related_specs: []
requirement: "Credenciales cifradas y nunca expuestas"
scenario: "Crear una conexión con clave de API"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-SEC-007", "NFR-COMP-008"]
invariants: []
priority: critical
type: security
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
input: {"credential":{"keyId":"…a1b2","secret":"<secreto de prueba generado>"}}
steps:
  - "POST W/imports/connections"
  - "GET W/imports/connections/{id}"
  - "Leer imports.connection_credential como migrator"
expected_result:
  - "Respuestas con fingerprint \"…a1b2\" y sin secreto"
  - "Fila con ciphertext y wrapped_dek; el secreto no aparece en claro"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-007 — La credencial se guarda cifrada y solo se muestra su huella

## Intención

Cifrado de sobre por credencial.

## Escenario

```gherkin
Cuando creo una conexión con una clave terminada en a1b2
Entonces solo veo …a1b2
  Y la base guarda solo el texto cifrado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
