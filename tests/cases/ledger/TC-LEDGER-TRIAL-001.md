---
id: TC-LEDGER-TRIAL-001
title: Solo el OWNER obtiene el balance de comprobación por moneda
spec: ledger/balances
related_specs: []
requirement: Vista técnica de balance de comprobación
scenario: Consulta por el propietario
requirement_status: confirmed
fr: [FR-LEDGER-016]
nfr: [NFR-SEC-003]
invariants: [INV-004]
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [trial-balance, rbac]
error_code: INSUFFICIENT_ROLE
preconditions:
- Workspace W1 con Bank A 685.00 BOB, EQUITY:FX_TRADING:BOB -690.00 BOB, EXPENSE:BOB 5.00 BOB (y sus contrapartes en USDT)
- Usuario U1 OWNER y usuario U2 con rol distinto de OWNER
input:
  request: GET /api/v1/workspaces/W1/ledger/trial-balance?asOf=2026-03-31
steps:
- Llamar como U1
- Llamar como U2
expected_result:
- U1 recibe 200 con las líneas de BOB (685.00, -690.00, 5.00) y total "0.00" BOB, y las de USDT con total "0.000000" USDT
- Todos los montos son strings decimales a la escala de su moneda
- U2 recibe 403 con code INSUFFICIENT_ROLE
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-TRIAL-001 — Solo el OWNER obtiene el balance de comprobación por moneda

## Intención

FR-LEDGER-016 (Could): vista técnica para diagnóstico; nunca expuesta a roles no propietarios.

## Escenario

```gherkin
Dado un workspace cuyo ledger tiene "Bank A" 685.00 BOB, "EQUITY:FX_TRADING:BOB" -690.00 BOB y "EXPENSE:BOB" 5.00 BOB
Cuando el OWNER consulta el balance de comprobación al 2026-03-31
Entonces el total en BOB es 0.00 BOB
```
