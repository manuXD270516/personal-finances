---
id: TC-IMPORTS-BANKING-026
title: "Depósitos y recompensas pasan por las reglas del workspace"
spec: imports/banking-providers
related_specs: ["rules/rule-engine"]
requirement: "Depósitos, retiros, comisiones y recompensas"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-014", "FR-IMPORTS-008"]
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
  - "Regla \"Staking\": descripción contiene `staking` ⇒ categoría de ingreso \"Rendimientos\""
input: {"records":["REWARD 0.250000 USDT \"Staking reward\"","DEPOSIT 300.000000 USDT"]}
steps:
  - "Sincronizar y ver la vista previa"
expected_result:
  - "Recompensa: ingreso en Rendimientos con origen en la regla Staking"
  - "Depósito: ingreso sin categoría con señal POSSIBLE_TRANSFER"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-026 — Depósitos y recompensas pasan por las reglas del workspace

## Intención

Integración con add-rule-engine.

## Escenario

```gherkin
Dada la regla Staking
Cuando sincronizo una recompensa y un depósito
Entonces la recompensa queda clasificada por la regla
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
