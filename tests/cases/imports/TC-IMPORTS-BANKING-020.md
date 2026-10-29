---
id: TC-IMPORTS-BANKING-020
title: "Una ventana solapada no crea duplicados"
spec: imports/banking-providers
related_specs: []
requirement: "Idempotencia por identificador del proveedor"
scenario: "Ventana solapada"
requirement_status: provisional
fr: ["FR-IMPORTS-010", "FR-TRANSACTIONS-032"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: integration
level: import
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
input: {"first":"2026-09-01..2026-09-30 (20 creadas)","second":"2026-09-15..2026-10-15 (18 registros, 9 ya importados)"}
steps:
  - "Aprobar la primera"
  - "Sincronizar la segunda y aprobar"
expected_result:
  - "Vista previa: 9 ya importados"
  - "Se crean 9; total 29"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-020 — Una ventana solapada no crea duplicados

## Intención

INV-014 con referencia externa del proveedor.

## Escenario

```gherkin
Dadas 20 transacciones de septiembre
Cuando sincronizo una ventana solapada con 9 ya importados
Entonces solo se crean 9
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
