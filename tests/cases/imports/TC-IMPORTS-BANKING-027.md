---
id: TC-IMPORTS-BANKING-027
title: "Un archivo de historial con formato verificado produce conversiones"
spec: imports/banking-providers
related_specs: []
requirement: "Importación por archivo del historial de un exchange"
scenario: "Archivo de trades con formato verificado"
requirement_status: provisional
fr: ["FR-IMPORTS-014", "FR-IMPORTS-004"]
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
  - "Usuario EDITOR"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Conexión de archivo \"Exchange archivo\" (formato simulado VERIFIED en test)"
input: {"file":"tests/fixtures/imports/exchange/fake-trades/input.csv (3 filas sintéticas)"}
steps:
  - "Subir el archivo a la conexión"
expected_result:
  - "3 conversiones propuestas con referencias externas del exchange"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-027 — Un archivo de historial con formato verificado produce conversiones

## Intención

Proveedor de tipo archivo sin credenciales.

## Escenario

```gherkin
Dado un historial sintético de 3 trades
Cuando lo subo
Entonces se proponen 3 conversiones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
