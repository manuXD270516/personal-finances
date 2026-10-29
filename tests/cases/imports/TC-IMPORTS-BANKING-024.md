---
id: TC-IMPORTS-BANKING-024
title: "Un retiro se propone como gasto con su comisión de red aparte"
spec: imports/banking-providers
related_specs: []
requirement: "Depósitos, retiros, comisiones y recompensas"
scenario: "Retiro con comisión de red"
requirement_status: provisional
fr: ["FR-IMPORTS-014"]
nfr: []
invariants: []
priority: medium
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
input: {"withdrawal":"200.000000 USDT","networkFee":"1.000000 USDT"}
steps:
  - "Sincronizar y ver la vista previa"
expected_result:
  - "Gasto 200.000000 USDT con señal POSSIBLE_TRANSFER"
  - "Gasto Fees 1.000000 USDT"
  - "Saldo propuesto de Exchange USDT baja 201.000000 USDT"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-024 — Un retiro se propone como gasto con su comisión de red aparte

## Intención

docs/13 §6.4.

## Escenario

```gherkin
Dado un retiro de 200.000000 USDT con fee de red de 1.000000 USDT
Cuando sincronizo
Entonces veo el gasto y la comisión por separado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
