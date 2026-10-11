---
id: TC-DEBT-CARD-031
title: 'El pago de tarjeta suma en el comprometido como transferencia a una cuenta no líquida'
spec: commitments/recurrence-engine
related_specs: ['debt/credit-cards', 'reporting/cash-flow-calendar']
requirement: 'Pago de tarjeta en el comprometido y en próximos pagos'
scenario: 'Pago de tarjeta en el comprometido de noviembre'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-011', 'FR-DEBT-013']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/commitments/src/application/card-payment.service.test.ts
  - packages/contexts/commitments/src/domain/card-payment.test.ts
  - packages/contexts/commitments/test/integration/pg-card-payment.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['recurrence', 'committed']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Hoy 2026-11-01, periodo 2026-11'
  - 'Pago de Visa Oro BOB 1120.50 BOB del 2026-11-15 sin resolver'
  - '"Internet" 199.00 BOB del 2026-11-20'
input:
  period: '2026-11'
steps:
  - 'Consultar el comprometido del periodo'
  - 'Consultar el periodo 2027-01 con la ocurrencia del 2027-01-15 sin monto'
expected_result:
  - 'Comprometido 1319.50 BOB'
  - '2027-01: no suma y se informa 1 pago sin monto'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-031 — El pago de tarjeta suma en el comprometido como transferencia a una cuenta no líquida

## Intención

D127: transferencias líquida → no líquida cuentan en el comprometido; CARD_PAYMENT es una de ellas.

## Escenario

```gherkin
Dado el pago de tarjeta de 1120.50 BOB y el "Internet" de 199.00 BOB en noviembre
Cuando consulto el comprometido
Entonces es 1319.50 BOB
```

## Notas

- Cubre "Ciclo futuro sin cuotas".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
