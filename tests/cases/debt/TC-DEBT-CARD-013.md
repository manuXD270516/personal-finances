---
id: TC-DEBT-CARD-013
title: 'El estado de cuenta se emite una vez y se recalcula con una compra retroactiva'
spec: debt/credit-cards
related_specs: []
requirement: 'Emisión única y recálculo del estado de cuenta'
scenario: 'Compra retroactiva en un ciclo cerrado'
requirement_status: provisional
fr: ['FR-DEBT-013', 'FR-NOTIFY-005']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'idempotency']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
input:
  runs: 'debt.card-daily dos veces el 2026-10-26'
  backdated: 'compra 45.00 BOB con fecha 2026-10-24 registrada el 2026-10-28'
steps:
  - 'Correr el job dos veces (también en paralelo)'
  - 'Registrar la compra retroactiva y consultar el estado de cuenta'
expected_result:
  - 'Un único estado de cuenta y un único CardStatementIssued.v1'
  - 'Recalculado: facturado 1165.50, mínimo 58.28, diferencia 45.00 BOB'
  - 'Sin segundo hecho de emisión'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-013 — El estado de cuenta se emite una vez y se recalcula con una compra retroactiva

## Intención

Emisión idempotente y transparencia ante cambios retroactivos.

## Escenario

```gherkin
Dado el estado de cuenta emitido con 1120.50 BOB
Cuando registro una compra de 45.00 BOB con fecha 2026-10-24
Entonces se muestra recalculado en 1165.50 BOB con diferencia 45.00 BOB
  Y no se publica otra emisión
```

## Notas

- Cubre "Emisión repetida".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
