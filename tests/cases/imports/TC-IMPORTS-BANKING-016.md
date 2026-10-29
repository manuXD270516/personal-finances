---
id: TC-IMPORTS-BANKING-016
title: "Una credencial con clave maestra ausente no detiene las demás"
spec: imports/banking-providers
related_specs: []
requirement: "Rotación de la clave maestra"
scenario: null
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
  - "2 conexiones: una con kid k0 (ausente) y otra con k1"
input: {}
steps:
  - "Sincronizar ambas"
expected_result:
  - "La de k0 queda NEEDS_ATTENTION"
  - "La de k1 sincroniza normalmente"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-016 — Una credencial con clave maestra ausente no detiene las demás

## Intención

Falla aislada por conexión.

## Escenario

```gherkin
Dada una credencial envuelta con una clave ausente
Cuando sincronizo todas
Entonces solo esa conexión requiere atención
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
