---
id: TC-LEDGER-TRIAL-001
title: Un miembro VIEWER obtiene el balance de comprobación por moneda
spec: ledger/balances
related_specs: []
requirement: Vista técnica de balance de comprobación
scenario: Consulta por un miembro
requirement_status: confirmed
fr: [FR-LEDGER-016]
nfr: [NFR-SEC-003]
invariants: [INV-004]
priority: low
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/ledger-trial-balance.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: [trial-balance, rbac]
error_code: WORKSPACE_ACCESS_DENIED
preconditions:
- Workspace W1 con Bank A 685.00 BOB, EQUITY:FX_TRADING:BOB -690.00 BOB, EXPENSE:BOB 5.00 BOB (y sus contrapartes en USDT)
- Usuario U1 con rol VIEWER en W1 y usuario U2 que no es miembro de W1
input:
  request: GET /api/v1/workspaces/W1/ledger/trial-balance?asOf=2026-03-31
steps:
- Llamar como U1
- Llamar como U2
expected_result:
- U1 recibe 200 con las líneas de BOB (685.00, -690.00, 5.00) y total "0.00" BOB, y las de USDT con total "0.000000" USDT
- Todos los montos son strings decimales a la escala de su moneda
- U2 recibe 403 con code WORKSPACE_ACCESS_DENIED y ninguna línea del ledger
created: 2026-10-02
updated: 2026-10-05
---

# TC-LEDGER-TRIAL-001 — Un miembro VIEWER obtiene el balance de comprobación por moneda

## Intención

FR-LEDGER-016 (Could): vista técnica para diagnóstico, de solo lectura, disponible desde el rol `VIEWER` (docs/31 D44, owner 2026-10-05; antes decía solo `OWNER`); nunca expuesta a quien no es miembro del workspace.

## Escenario

```gherkin
Dado un workspace cuyo ledger tiene "Bank A" 685.00 BOB, "EQUITY:FX_TRADING:BOB" -690.00 BOB y "EXPENSE:BOB" 5.00 BOB
Cuando un miembro con rol VIEWER consulta el balance de comprobación al 2026-03-31
Entonces el total en BOB es 0.00 BOB
```

## Notas

- Automatizado 2026-10-05 (add-ledger-core 6.3) por HTTP contra PostgreSQL real: OWNER y VIEWER obtienen el mismo cuerpo (validado contra el contrato `getLedgerTrialBalance`), con las líneas BOB 685.00 / -690.00 / 5.00 y totales `0.00 BOB` y `0.000000 USDT`; un no miembro recibe 403 `WORKSPACE_ACCESS_DENIED` sin líneas; `asOf` por defecto = hoy en la zona del workspace.
