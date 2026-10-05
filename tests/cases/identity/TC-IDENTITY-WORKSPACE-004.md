---
id: TC-IDENTITY-WORKSPACE-004
title: Cambiar la moneda base de BOB a USD no altera montos, asientos ni tasas históricas
spec: identity/workspace-membership
related_specs: []
requirement: Cambio de moneda base sin alterar la historia
scenario: Cambio de BOB a USD con historia multi-moneda
requirement_status: confirmed
fr:
- FR-IDENTITY-005
nfr:
- NFR-DATA-006
invariants:
- INV-011
priority: critical
type: integration
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/workspace-base-currency.api.test.ts
  - packages/contexts/identity/src/application/identity.service.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- workspace
- money
- multi-currency
- regression
error_code: null
preconditions:
- W1 Personal Demo con base BOB
- Un gasto de 685.00 BOB y una conversión de 100.000000 USDT a 685.00 BOB registrados
- Snapshot de conteos y sumas de ledger.journal_entry, ledger.posting, txn.conversion_detail y fx.exchange_rate
input:
  If-Match: versión vigente
  body:
    baseCurrency: USD
steps:
- PATCH /api/v1/workspaces/{W1} como OWNER
- Comparar con el snapshot
expected_result:
- 200 con baseCurrency USD
- El gasto sigue en 685.00 BOB; la conversión sigue en 100.000000 USDT y 685.00 BOB
- Conteos y sumas por moneda de asientos, postings, detalles de conversión y tasas idénticos al snapshot
created: 2026-10-02
updated: 2026-10-04
---

# TC-IDENTITY-WORKSPACE-004 — Cambiar la moneda base de BOB a USD no altera montos, asientos ni tasas históricas

## Intención

La moneda base es de presentación, no contable; cambiarla nunca reescribe la historia (FR-IDENTITY-005, ARCHITECTURE §4).

## Escenario

```gherkin
Dado un workspace con un gasto de 685.00 BOB y una conversión de 100.000000 USDT a 685.00 BOB
Cuando el OWNER cambia la moneda base a "USD"
Entonces el gasto sigue siendo 685.00 BOB
  Y la conversión sigue siendo 100.000000 USDT y 685.00 BOB
  Y no se crea ni modifica ningún asiento
```

## Notas

- Requiere los changes add-transaction-recording y add-manual-conversions para sembrar los datos; antes de ellos se ejecuta con el seed SQL.
- Revisado 2026-10-04: se mantiene `not_automated` (advertencia R3 intencional). El test con su id es de aplicación; falta el test de API con gasto y conversión sembrados y la comparación del snapshot de asientos, postings, detalles y tasas (add-workspace-identity 7.3).
- Automatizado 2026-10-04 (add-workspace-identity 7.3): test de API con gasto de 685.00 BOB y conversión 100.000000 USDT → 685.00 BOB sembrados por la API real; compara conteos, sumas por moneda y huella fila a fila de asientos, postings, detalles de conversión y tasas antes y después del PATCH.
