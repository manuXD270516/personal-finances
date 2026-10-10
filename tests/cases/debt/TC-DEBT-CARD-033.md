---
id: TC-DEBT-CARD-033
title: 'Cuotas futuras de la tarjeta en los próximos pagos'
spec: reporting/cash-flow-calendar
related_specs: ['debt/credit-cards']
requirement: 'Cuotas de tarjeta futuras en los próximos pagos'
scenario: 'Cuota de la laptop en 60 días'
requirement_status: provisional
fr: ['FR-DEBT-017', 'FR-REPORTING-016']
nfr: []
invariants: []
priority: low
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
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
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-033 — Cuotas futuras de la tarjeta en los próximos pagos

## Intención

Las cuotas futuras alimentan Q8 y el comprometido.

## Escenario

```gherkin
Dado la segunda cuota de "Laptop" en el ciclo que vence el 2026-12-15
Cuando consulto 60 días
Entonces aparece 333.33 BOB estimado como cuotas
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
