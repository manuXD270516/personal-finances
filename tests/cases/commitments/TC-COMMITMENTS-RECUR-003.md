---
id: TC-COMMITMENTS-RECUR-003
title: 'Los tipos LOAN_PAYMENT y CARD_PAYMENT se rechazan como reservados hasta Phase 4'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Tipos de préstamo y tarjeta reservados'
scenario: 'Cuota de préstamo aún no disponible'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-001']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'reserved-kinds']
error_code: RECURRING_KIND_NOT_AVAILABLE
preconditions:
  - 'Cuenta "Banco BOB" activa'
input:
  kind: 'LOAN_PAYMENT 1200.00 BOB mensual'
  kind2: 'CARD_PAYMENT 1450.00 BOB mensual'
steps:
  - 'POST W/recurring con kind LOAN_PAYMENT'
  - 'POST W/recurring con kind CARD_PAYMENT'
expected_result:
  - 'Ambas 422 RECURRING_KIND_NOT_AVAILABLE'
  - 'No se crea nada'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-003 — Los tipos LOAN_PAYMENT y CARD_PAYMENT se rechazan como reservados hasta Phase 4

## Intención

Reserva los valores en el contrato sin habilitar comportamiento de Debt antes de Phase 4 (design decisión 3).

## Escenario

```gherkin
Cuando el EDITOR crea una definición de tipo LOAN_PAYMENT por 1200.00 BOB mensual
Entonces se rechaza con RECURRING_KIND_NOT_AVAILABLE
```

## Notas

- El scenario "Pago de tarjeta como transferencia" se cubre con TC-COMMITMENTS-RECUR-004 (TRANSFER a la cuenta pasivo, D27).
