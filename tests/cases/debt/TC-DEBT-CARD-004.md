---
id: TC-DEBT-CARD-004
title: 'Límite compartido en la moneda de una cuenta y rechazo en moneda ajena'
spec: debt/credit-cards
related_specs: []
requirement: 'Límite compartido o separado'
scenario: 'Límite compartido en BOB'
requirement_status: provisional
fr: ['FR-DEBT-016', 'FR-DEBT-012']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'limit']
error_code: VALIDATION_FAILED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Cuentas "Visa Oro BOB" y "Visa Oro USD" activas'
input:
  ok: 'limitMode SHARED 15000.00 BOB'
  ko: 'limitMode SHARED 2000.00 USDT'
steps:
  - 'Registrar con límite compartido 15000.00 BOB'
  - 'Registrar con límite compartido 2000.00 USDT'
expected_result:
  - 'Primera: un único límite de 15000.00 BOB'
  - 'Segunda: 422 VALIDATION_FAILED'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-004 — Límite compartido en la moneda de una cuenta y rechazo en moneda ajena

## Intención

El límite compartido debe estar en la moneda de alguna cuenta para poder valorar la utilización.

## Escenario

```gherkin
Dado una tarjeta bimoneda BOB + USD
Cuando registro un límite compartido en BOB y otro en USDT
Entonces el de BOB se acepta y el de USDT se rechaza
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
