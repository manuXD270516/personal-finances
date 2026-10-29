---
id: TC-IMPORTS-BANKING-034
title: "La auditoría de la creación no contiene el secreto"
spec: imports/banking-providers
related_specs: []
requirement: "Permisos y auditoría de las conexiones"
scenario: "Auditoría de la creación"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: []
invariants: ["INV-029"]
priority: high
type: integration
level: database-integration
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
  - "Crear la conexión"
  - "Leer audit.audit_log y lifecycle"
expected_result:
  - "Registro con proveedor, huella …a1b2 y mapeos"
  - "Sin secreto; recorrido PENDING_VERIFICATION"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-034 — La auditoría de la creación no contiene el secreto

## Intención

Auditoría en la misma unidad de trabajo.

## Escenario

```gherkin
Cuando creo Exchange principal
Entonces la auditoría tiene la huella y los mapeos sin el secreto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
