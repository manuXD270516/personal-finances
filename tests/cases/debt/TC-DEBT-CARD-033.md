---
id: TC-DEBT-CARD-033
title: 'Cuotas futuras de la tarjeta en los próximos pagos'
spec: reporting/cash-flow-calendar
related_specs: ['debt/credit-cards']
requirement: 'Cuotas de tarjeta futuras en los próximos pagos'
scenario: 'Cuota de la laptop en 60 días'
requirement_status: confirmed
fr: ['FR-DEBT-017', 'FR-REPORTING-016']
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/commitments/src/application/card-payment.service.test.ts
  - packages/contexts/commitments/src/domain/card-payment.test.ts
  - packages/contexts/debt/src/domain/payment-plan-expectation.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['upcoming-payments', 'installments']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Plan "Laptop" 3 cuotas; plan de pago activo; hoy 2026-10-20'
input:
  window: '60'
steps:
  - 'Consultar los próximos 60 días'
expected_result:
  - '2026-12-15 "Pago de tarjeta · Visa Oro" 333.33 BOB estimado con indicación "cuotas"'
  - 'La respuesta informa el origen del monto esperado (change fix-phase-4-debt-followups): el pago del 2026-12-15 queda OPEN_CYCLE porque tras la emisión del 2026-10-25 su ciclo es el abierto, y el del 2027-01-15 (333.34 BOB, ciclo posterior) lleva expectedBasis INSTALLMENTS'
created: 2026-10-10
updated: 2026-11-26
---

# TC-DEBT-CARD-033 — Cuotas futuras de la tarjeta en los próximos pagos

## Intención

Las cuotas futuras alimentan Q8 y el comprometido.

## Escenario

```gherkin
Dado la segunda cuota de "Laptop" en el ciclo que vence el 2026-12-15
Cuando consulto 60 días
Entonces aparece 333.33 BOB estimado como cuotas
Y la respuesta informa que el origen del monto esperado son cuotas programadas
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
- 2026-11-25, change `fix-phase-4-debt-followups` (75): el test automatizado solo comprobaba el monto y `amountType: ESTIMATED`, no la indicación «cuotas». El change agrega el origen del esperado (`expectedBasis`) y el test pasa a comprobarlo (tarea 7.1, hecha el 2026-11-26: el API, el dominio de DEBT y COMMITMENTS y la UI citan este TC).
