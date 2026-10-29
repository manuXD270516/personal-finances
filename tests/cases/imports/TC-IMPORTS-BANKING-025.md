---
id: TC-IMPORTS-BANKING-025
title: "Las órdenes P2P quedan excluidas con motivo"
spec: imports/banking-providers
related_specs: []
requirement: "Depósitos, retiros, comisiones y recompensas"
scenario: "Orden P2P"
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
input: {"p2p":"venta de 100.000000 USDT por 690.00 BOB"}
steps:
  - "Sincronizar, ver la vista previa y aprobar"
expected_result:
  - "Fila excluida con CONNECTION_RECORD_UNSUPPORTED"
  - "Ninguna transacción creada"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-025 — Las órdenes P2P quedan excluidas con motivo

## Intención

P2P fuera de alcance (ADR-0029 C4).

## Escenario

```gherkin
Dada una orden P2P
Cuando sincronizo
Entonces la fila queda excluida
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
