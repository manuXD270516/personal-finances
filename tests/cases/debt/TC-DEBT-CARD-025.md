---
id: TC-DEBT-CARD-025
title: 'Anular la compra cancela el plan de cuotas'
spec: debt/credit-cards
related_specs: []
requirement: 'Anular la compra cancela su plan de cuotas'
scenario: 'Laptop devuelta'
requirement_status: provisional
fr: ['FR-DEBT-017']
nfr: []
invariants: ['INV-028']
priority: low
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'installments', 'void']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Plan "Laptop" 3 cuotas con la primera facturada el 2026-10-25'
input:
  void: 'anulación de "Laptop" el 2026-11-02'
steps:
  - 'Anular la compra y procesar debt.card-activity'
expected_result:
  - 'Plan CANCELLED "compra anulada"'
  - 'Calendario sin 333.33 al 2026-12-15 ni 333.34 al 2027-01-15'
  - 'La cuota del ciclo emitido sigue en el historial'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-025 — Anular la compra cancela el plan de cuotas

## Intención

Evita restar cuotas de una compra que ya no existe.

## Escenario

```gherkin
Dado el plan "Laptop" con la primera cuota facturada
Cuando se anula la compra
Entonces el plan queda cancelado y el calendario ya no lista sus cuotas
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
