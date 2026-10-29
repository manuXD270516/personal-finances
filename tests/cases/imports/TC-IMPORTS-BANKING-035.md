---
id: TC-IMPORTS-BANKING-035
title: "Las conexiones de un workspace no se ven en otro"
spec: imports/banking-providers
related_specs: []
requirement: "Permisos y auditoría de las conexiones"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: critical
type: security
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "Workspace \"W2\""
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC en W1"
input: {}
steps:
  - "Listar conexiones en W2"
  - "Consultar imports.connection y connection_credential sin contexto"
expected_result:
  - "W2 no ve la conexión"
  - "Sin contexto: PF002 (fail-closed)"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-035 — Las conexiones de un workspace no se ven en otro

## Intención

RLS forzada en las tablas nuevas.

## Escenario

```gherkin
Dada una conexión en W1
Cuando W2 lista sus conexiones
Entonces no la ve
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
