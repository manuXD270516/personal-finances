---
id: TC-IMPORTS-BANKING-022
title: "Sincronizar dos veces el mismo rango crea cero transacciones (PBT)"
spec: imports/banking-providers
related_specs: []
requirement: "Idempotencia por identificador del proveedor"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: property
level: property
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
input: {"generator":"conjuntos aleatorios de registros y ventanas solapadas"}
steps:
  - "PBT: sync(v1); sync(v2) con v2 solapada ⇒ creaciones = registros nuevos exactos (timeout explícito)"
expected_result:
  - "La propiedad se cumple"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-022 — Sincronizar dos veces el mismo rango crea cero transacciones (PBT)

## Intención

docs/13 §16.2 propiedad de reimport.

## Escenario

```gherkin
Dadas dos ventanas solapadas aleatorias
Cuando sincronizo ambas
Entonces solo se crean los registros nuevos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
