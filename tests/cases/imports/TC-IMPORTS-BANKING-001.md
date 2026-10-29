---
id: TC-IMPORTS-BANKING-001
title: "El proveedor simulado pasa la suite de contrato común"
spec: imports/banking-providers
related_specs: []
requirement: "Puerto común de proveedores bancarios y de exchange"
scenario: "Proveedor de prueba en la suite de contrato"
requirement_status: provisional
fr: ["FR-IMPORTS-013", "FR-IMPORTS-002"]
nfr: []
invariants: ["INV-001"]
priority: high
type: integration
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
input: {"window":{"from":"2026-09-01","to":"2026-09-30"},"records":["2 TRADE","1 DEPOSIT","1 WITHDRAWAL","1 REWARD"]}
steps:
  - "Ejecutar providerContractSuite(FAKE_EXCHANGE, fixtures)"
  - "Cortar en la página 2 y reanudar con el cursor"
expected_result:
  - "Ids estables, ventana respetada, montos como texto decimal exacto"
  - "La reanudación entrega cada registro una sola vez"
  - "Los registros llegan a la etapa normalize del import"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-001 — El proveedor simulado pasa la suite de contrato común

## Intención

Toda fuente pasa la misma suite antes de habilitarse.

## Escenario

```gherkin
Dado el proveedor simulado con 5 registros de septiembre
Cuando corre la suite de contrato
Entonces la pasa
  Y sus registros llegan a la normalización
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
